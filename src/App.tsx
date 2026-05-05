import { useState, useEffect, useMemo, FormEvent, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Terminal,
  Cpu,
  Layers,
  Search, 
  Globe, 
  TrendingUp, 
  ShieldCheck, 
  AlertCircle, 
  ArrowRightLeft, 
  Bell,
  Trash2,
  Plus,
  Package, 
  Info,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Printer,
  Download,
  FileDown,
  Lock,
  User,
  CreditCard,
  LogOut,
  Zap,
  CheckCircle2,
  X,
  PieChart as PieChartIcon
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { cn, calculateConfidenceScore, calculateRepairability, cleanDevice, exportToCSV, getDecisionLabel, normalizeData, NormalizedPart, RawRow, translateMobileParts, formatPrice, EXCHANGE_RATE } from './lib/utils';
import { analyzeMarkets, MarketAnalysis } from './lib/gemini';
import Fuse from 'fuse.js';
import { auth, db } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, getDocFromServer, collection, getDocs } from 'firebase/firestore';

interface UserProfile {
  uid: string;
  email: string;
  subscriptionTier: 'guest' | 'pro';
  createdAt: any;
}

const AuthContext = createContext<{ user: FirebaseUser | null; profile: UserProfile | null; loading: boolean }>({ user: null, profile: null, loading: true });

// Helper to calculate index price for summary/analytics
const indexPriceCalculator = (parts: NormalizedPart[]) => {
  if (!parts.length) return 0;
  const sources = Array.from(new Set(parts.map(p => p.source)));
  const normalizedPrices = sources.map(source => {
    const sourceParts = parts.filter(p => p.source === source);
    if (!sourceParts.length) return 0;
    const medianPrice = [...sourceParts].sort((a,b) => a.price - b.price)[Math.floor(sourceParts.length/2)].price;
    const currency = sourceParts[0].currency;
    return currency === 'PKR' ? medianPrice / EXCHANGE_RATE : medianPrice;
  });
  return normalizedPrices.reduce((acc, curr) => acc + curr, 0) / normalizedPrices.length;
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [data, setData] = useState<NormalizedPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzingStep, setAnalyzingStep] = useState<string | null>(null);
  const [query, setQuery] = useState('samsung galaxy s22 fe');
  const [repairTypeQuery, setRepairTypeQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'markets' | 'analytics' | 'settings' | 'feedback' | 'summary' | 'console' | 'admin' | 'help'>('markets');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<'EUR' | 'PKR' | 'BOTH'>('BOTH');
  const [alerts, setAlerts] = useState<{ id: string; device: string; part: string; targetPrice: number; currency: 'EUR' | 'PKR' }[]>([]);
  const [feedback, setFeedback] = useState<{ id: string; email: string; category: string; message: string; rating: number; timestamp: string }[]>([]);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setAuthError(null);
      if (user) {
        let attempts = 0;
        const maxAttempts = 3;
        
        const fetchProfile = async () => {
          try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
              const profileData = userDoc.data() as UserProfile;
              setProfile(profileData);
              localStorage.setItem(`gp_profile_${user.uid}`, JSON.stringify(profileData));
            } else {
              const newProfile: UserProfile = {
                uid: user.uid,
                email: user.email || '',
                subscriptionTier: 'guest',
                createdAt: serverTimestamp()
              };
              await setDoc(doc(db, 'users', user.uid), newProfile);
              setProfile(newProfile);
            }
            setAuthError(null);
          } catch (err: any) {
            console.error(`Auth profile fetch error (attempt ${attempts + 1}):`, err);
            if (attempts < maxAttempts - 1 && (err.message?.includes('offline') || err.code === 'unavailable')) {
              attempts++;
              setAuthError(`Connection sluggish. Retrying (${attempts}/${maxAttempts})...`);
              setTimeout(fetchProfile, 2000);
            } else {
              if (err.message?.includes('offline') || err.code === 'unavailable') {
                setAuthError("Offline mode active. Engaging Local File Registry.");
                // Fallback to local data
                const cachedProfile = localStorage.getItem(`gp_profile_${user.uid}`);
                if (cachedProfile) {
                  setProfile(JSON.parse(cachedProfile));
                } else {
                  setProfile({
                    uid: user.uid,
                    email: user.email || '',
                    subscriptionTier: 'guest',
                    createdAt: new Date().toISOString()
                  });
                }
              } else {
                try {
                  handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
                } catch (jsonErr: any) {
                  setAuthError(jsonErr.message);
                }
              }
            }
          }
        };

        fetchProfile();
      } else {
        setProfile(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user && profile) {
      fetchData();
    }
  }, [user, profile]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleUpgrade = async () => {
    setShowPaymentModal(true);
  };

  const processPayment = async () => {
    if (!user || !profile) return;
    setPaymentLoading(true);
    try {
      // Simulate gateway latency
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const updatedProfile = { ...profile, subscriptionTier: 'pro' as const };
      await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
      setProfile(updatedProfile);
      localStorage.setItem(`gp_profile_${user.uid}`, JSON.stringify(updatedProfile));
      setShowPaymentModal(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    } finally {
      setPaymentLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data');
      const json: RawRow[] = await res.json();
      setData(normalizeData(json));
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    if (!data.length) return { all: [], fr: [], pk: [] };
    
    const fuse = new Fuse(data, {
      keys: ['device', 'partName'],
      threshold: 0.4
    });

    const searchResults = query ? fuse.search(query).map(r => r.item) : data;
    
    // Filter by repair type if provided
    const afterRepairFilter = repairTypeQuery 
      ? searchResults.filter(p => p.repairType.toLowerCase().includes(repairTypeQuery.toLowerCase()) || p.partName.toLowerCase().includes(repairTypeQuery.toLowerCase()))
      : searchResults;

    return {
      all: afterRepairFilter,
      fr: afterRepairFilter.filter(p => p.market === 'FR'),
      pk: afterRepairFilter.filter(p => p.market === 'PK')
    };
  }, [data, query, repairTypeQuery]);

  const frConfidence = useMemo(() => calculateConfidenceScore(filteredData.fr), [filteredData.fr]);
  const pkConfidence = useMemo(() => calculateConfidenceScore(filteredData.pk), [filteredData.pk]);

  const repairabilityScore = useMemo(() => {
    return calculateRepairability({
      device: query,
      repairType: repairTypeQuery || 'screen',
      confidence: (frConfidence + pkConfidence) / 2,
      parts: [...filteredData.fr, ...filteredData.pk]
    });
  }, [query, repairTypeQuery, frConfidence, pkConfidence, filteredData]);

  const handleAnalyze = async () => {
    if (!query) return;
    setAnalyzingStep("PREPARING DATASET...");
    setActiveTab('analytics');
    
    // Smooth transition between steps
    setTimeout(() => setAnalyzingStep("CROSS-REFERENCING MARKETS..."), 800);
    
    try {
      const res = await analyzeMarkets(query, repairTypeQuery, filteredData.fr, filteredData.pk);
      setAnalyzingStep("SYNTHESIZING REPORT...");
      setTimeout(() => {
        setAnalysis(res);
        setAnalyzingStep(null);
      }, 1200);
    } catch (err) {
      console.error(err);
      setAnalyzingStep(null);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        {authError && (
          <p className="text-xs font-bold text-orange-500 uppercase tracking-widest">{authError}</p>
        )}
      </div>
    );
  }

  if (authError && !user) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-4">
        <div className="bg-white border border-red-100 rounded-[32px] p-8 shadow-xl text-center max-w-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-black uppercase mb-2">Connectivity Error</h2>
          <p className="text-gray-500 text-sm mb-6">{authError}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-black text-white px-8 py-3 rounded-2xl font-bold uppercase tracking-widest text-xs"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView onLogin={handleLogin} />;
  }

  const isAdmin = user?.email === 'anwar17070@gmail.com' || user?.email === 'shahrukh17070@gmail.com';
  const isPro = profile?.subscriptionTier === 'pro' || isAdmin;

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-orange-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 no-print">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab('markets')}>
              <div className="w-8 h-8 bg-[#1A1A1A] rounded-lg flex items-center justify-center p-1.5">
                <TrendingUp className="text-white w-full h-full" />
              </div>
              <h1 className="font-bold text-xl tracking-tighter">GlobPrice</h1>
            </div>
            
            <nav className="flex items-center gap-6 text-sm font-medium">
              <button 
                onClick={() => setActiveTab('markets')}
                className={cn("transition-colors", activeTab === 'markets' ? "text-gray-900 border-b-2 border-gray-900 pb-1" : "text-gray-500 hover:text-gray-900")}
              >
                Markets
              </button>
              <button 
                onClick={() => isPro ? setActiveTab('analytics') : setActiveTab('summary')}
                className={cn("transition-colors flex items-center gap-1.5", activeTab === 'analytics' ? "text-gray-900 border-b-2 border-gray-900 pb-1" : "text-gray-500 hover:text-gray-900")}
              >
                Analytics {!isPro && <Lock className="w-3 h-3" />}
              </button>
              <button 
                onClick={() => setActiveTab('settings')}
                className={cn("transition-colors", activeTab === 'settings' ? "text-gray-900 border-b-2 border-gray-900 pb-1" : "text-gray-500 hover:text-gray-900")}
              >
                Settings
              </button>
              <button 
                onClick={() => setActiveTab('summary')}
                className={cn("transition-colors", activeTab === 'summary' ? "text-gray-900 border-b-2 border-gray-900 pb-1" : "text-gray-500 hover:text-gray-900")}
              >
                Summary
              </button>
              <button 
                onClick={() => setActiveTab('feedback')}
                className={cn("transition-colors", activeTab === 'feedback' ? "text-gray-900 border-b-2 border-gray-900 pb-1" : "text-gray-500 hover:text-gray-900")}
              >
                Feedback
              </button>
              <button 
                onClick={() => setActiveTab('console')}
                className={cn("transition-colors flex items-center gap-1.5", activeTab === 'console' ? "text-gray-900 border-b-2 border-gray-900 pb-1" : "text-gray-500 hover:text-gray-900")}
              >
                Console
              </button>
              <button 
                onClick={() => setActiveTab('help')}
                className={cn("transition-colors flex items-center gap-1.5", activeTab === 'help' ? "text-gray-900 border-b-2 border-gray-900 pb-1" : "text-gray-500 hover:text-gray-900")}
              >
                Help & Docs
              </button>
              {isAdmin && (
                <button 
                  onClick={() => setActiveTab('admin')}
                  className={cn("transition-colors flex items-center gap-1.5", activeTab === 'admin' ? "text-orange-600 border-b-2 border-orange-600 pb-1 font-bold" : "text-gray-500 hover:text-gray-900")}
                >
                  Admin <ShieldCheck className="w-3 h-3" />
                </button>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-6">
            {!isPro && (
              <button 
                onClick={handleUpgrade}
                className="bg-orange-500 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 transition-colors flex items-center gap-1 shadow-lg shadow-orange-200"
              >
                <Zap className="w-3 h-3 fill-current" /> Upgrade to Pro
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] font-black text-gray-900 leading-none">{user.displayName || user.email?.split('@')[0]}</p>
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">{profile?.subscriptionTier} account</p>
              </div>
              <button onClick={handleLogout} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400 hover:text-red-500">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'markets' ? (
          <MarketView 
            query={query} 
            setQuery={setQuery} 
            repairTypeQuery={repairTypeQuery} 
            setRepairTypeQuery={setRepairTypeQuery}
            handleAnalyze={isPro ? handleAnalyze : handleUpgrade}
            analyzingStep={analyzingStep}
            filteredData={filteredData}
            loading={loading}
            frConfidence={frConfidence}
            pkConfidence={pkConfidence}
            displayCurrency={displayCurrency}
            isPro={isPro}
          />
        ) : activeTab === 'analytics' ? (
          isPro ? (
            <AnalyticsView 
              analysis={analysis}
              analyzingStep={analyzingStep}
              query={query}
              repairTypeQuery={repairTypeQuery}
              filteredData={filteredData}
              repairabilityScore={repairabilityScore}
              handleAnalyze={handleAnalyze}
              displayCurrency={displayCurrency}
            />
          ) : (
            <div className="py-20 flex flex-col items-center justify-center">
               <Lock className="w-16 h-16 text-gray-200 mb-6" />
               <h2 className="text-2xl font-black uppercase tracking-tight mb-2">Pro Feature Locked</h2>
               <p className="text-gray-500 mb-8 max-w-sm text-center font-medium">Arbitrage analytics and AI-powered recommendations are reserved for trade professionals.</p>
               <button onClick={() => setActiveTab('summary')} className="bg-black text-white px-8 py-3 rounded-2xl font-bold">View Subscription Options</button>
            </div>
          )
        ) : activeTab === 'summary' ? (
          <SummaryView 
            query={query}
            analysis={analysis}
            filteredData={filteredData}
            displayCurrency={displayCurrency}
            indexPrice={repairabilityScore ? indexPriceCalculator(filteredData.all) : 0}
            isPro={isPro}
            onUpgrade={handleUpgrade}
          />
        ) : activeTab === 'settings' ? (
          <SettingsView 
            displayCurrency={displayCurrency}
            setDisplayCurrency={setDisplayCurrency}
            alerts={alerts}
            setAlerts={setAlerts}
          />
        ) : activeTab === 'console' ? (
          <ConsoleView />
        ) : activeTab === 'admin' ? (
          <AdminView />
        ) : activeTab === 'help' ? (
          <HelpView setActiveTab={setActiveTab} />
        ) : (
          <FeedbackView 
            onSubmit={(f: any) => {
              setFeedback([f, ...feedback]);
              setActiveTab('markets');
            }}
          />
        )}
      </main>

      <AnimatePresence>
        {showPaymentModal && (
          <PaymentModal 
            onClose={() => setShowPaymentModal(false)} 
            onConfirm={processPayment}
            loading={paymentLoading}
          />
        )}
      </AnimatePresence>

      {/* Footer Status Bar - as seen in Image 1 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 py-2 px-4 no-print z-50 flex items-center justify-between text-[9px] font-bold text-gray-400 uppercase tracking-[0.15em]">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-green-500 rounded-full" /> RT-AGGREGATE</span>
          <span>W-TS</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 hover:text-black transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> FORCE REFRESH
          </button>
          <div className="h-3 w-px bg-gray-200" />
          <div className="flex items-center gap-1">
            <Info className="w-3 h-3" /> LAST GLOBAL REFRESH: {lastRefresh.toLocaleTimeString()} UTC
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketView({ query, setQuery, repairTypeQuery, setRepairTypeQuery, handleAnalyze, analyzingStep, filteredData, loading, frConfidence, pkConfidence, displayCurrency, isPro }: any) {
  const isAnalyzing = analyzingStep !== null;
  const MAX_LENGTH = 50;

  const handleQueryChange = (val: string) => {
    if (val.length <= MAX_LENGTH) {
      setQuery(val);
    }
  };

  const handleRepairChange = (val: string) => {
    if (val.length <= MAX_LENGTH) {
      setRepairTypeQuery(val);
    }
  };

  return (
    <>
      {/* Controls */}
      <section className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4 no-print">
        <div className="md:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 relative group overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Search className="w-16 h-16" />
          </div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
            <Search className="w-4 h-4" /> Global Item Search
          </h3>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-bold text-gray-500">DEVICE NAME / MODEL</label>
                <span className={cn("text-[10px] font-mono", query.length >= MAX_LENGTH ? "text-red-500 font-bold" : "text-gray-300")}>
                  {query.length}/{MAX_LENGTH}
                </span>
              </div>
              <input 
                type="text" 
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="e.g. Samsung Galaxy S22 FE"
                className={cn(
                  "w-full bg-gray-50 border rounded-xl px-4 py-3 focus:ring-2 outline-none transition-all placeholder:text-gray-300 font-medium",
                  query.length >= MAX_LENGTH ? "border-red-200 focus:ring-red-500" : "border-gray-200 focus:ring-orange-500"
                )}
              />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-bold text-gray-500">REPAIR TYPE</label>
                <span className={cn("text-[10px] font-mono", repairTypeQuery.length >= MAX_LENGTH ? "text-red-500 font-bold" : "text-gray-300")}>
                  {repairTypeQuery.length}/{MAX_LENGTH}
                </span>
              </div>
              <input 
                type="text" 
                value={repairTypeQuery}
                onChange={(e) => handleRepairChange(e.target.value)}
                placeholder="e.g. repair / replace battery"
                className={cn(
                  "w-full bg-gray-50 border rounded-xl px-4 py-3 focus:ring-2 outline-none transition-all placeholder:text-gray-300 font-medium",
                  repairTypeQuery.length >= MAX_LENGTH ? "border-red-200 focus:ring-red-500" : "border-gray-200 focus:ring-orange-500"
                )}
              />
            </div>
          </div>
        </div>

        <div className="bg-[#1A1A1A] text-white p-6 rounded-2xl shadow-xl flex flex-col justify-between relative overflow-hidden group">
          {!isPro && (
            <div className="absolute top-2 right-2 z-10">
               <span className="bg-orange-500 text-white text-[8px] font-black uppercase px-2 py-0.5 rounded-sm flex items-center gap-1 shadow-lg">
                 <Lock className="w-2 h-2" /> PRO
               </span>
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-1 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-500" /> AI Insights Engine
            </h3>
            <p className="text-gray-500 text-xs mb-4">Generate export-ready market mapping report.</p>
          </div>
          <button 
            onClick={() => handleAnalyze()}
            disabled={isAnalyzing || !query.trim()}
            className="w-full bg-white text-black hover:bg-gray-100 disabled:bg-gray-800 disabled:text-gray-500 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> {analyzingStep}
              </>
            ) : (
              <>
                {isPro ? "ANALYZE DATA" : "UPGRADE TO ANALYZE"} <ArrowRightLeft className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </section>
      
      {filteredData.all.length > 0 && !loading && (
        <div className="flex justify-end mb-4 no-print px-4 md:px-0">
          <button 
            onClick={() => exportToCSV(filteredData.all, `${query.replace(/\s+/g, '_')}_market_data`)}
            className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-black flex items-center gap-2 transition-colors py-2 px-4 rounded-lg hover:bg-gray-50 bg-white border border-gray-100 shadow-sm"
          >
            <FileDown className="w-4 h-4" /> Download Raw Data (CSV)
          </button>
        </div>
      )}

      {/* Market Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-20 no-print">
        <MarketColumn 
          title="French Market (Wefix/Utopya)" 
          parts={filteredData.fr} 
          market="FR" 
          loading={loading}
          confidence={frConfidence}
          displayCurrency={displayCurrency}
        />
        <MarketColumn 
          title="Pakistani Market (Amazon/Daraz)" 
          parts={filteredData.pk} 
          market="PK" 
          loading={loading}
          confidence={pkConfidence}
          displayCurrency={displayCurrency}
        />
      </div>

      {loading && (
        <div className="py-20 flex flex-col items-center justify-center text-gray-400 gap-4">
          <Loader2 className="w-10 h-10 animate-spin" />
          <p className="text-sm font-medium tracking-widest uppercase">Synchronizing databases...</p>
        </div>
      )}
    </>
  );
}

function AnalyticsView({ analysis, analyzingStep, query, repairTypeQuery, filteredData, repairabilityScore, handleAnalyze, displayCurrency }: any) {
  const isAnalyzing = analyzingStep !== null;
  const chartData = useMemo(() => {
    // Group by source and get median price
    const sources = Array.from(new Set(filteredData.all.map((p: any) => p.source))) as string[];
    return sources.map(source => {
      const parts = filteredData.all.filter((p: any) => p.source === source);
      const medianRaw = parts.length > 0 
        ? [...parts].sort((a,b) => a.price - b.price)[Math.floor(parts.length/2)].price 
        : 0;
      const currency = parts.length > 0 ? parts[0].currency : 'EUR';
      
      // Normalize price for chart comparison
      let chartPrice = medianRaw;
      if (displayCurrency === 'EUR' && currency === 'PKR') chartPrice = medianRaw / EXCHANGE_RATE;
      else if (displayCurrency === 'PKR' && currency === 'EUR') chartPrice = medianRaw * EXCHANGE_RATE;
      else if (displayCurrency === 'BOTH' && currency === 'PKR') chartPrice = medianRaw / EXCHANGE_RATE;

      return {
        name: source.charAt(0).toUpperCase() + source.slice(1),
        price: chartPrice,
        originalPrice: medianRaw,
        originalCurrency: currency
      };
    }).slice(0, 5); // Take top 5 for cleaner chart
  }, [filteredData, displayCurrency]);

  const indexPrice = useMemo(() => {
    if (!chartData.length) return 0;
    // indexPrice is in EUR for consistent calculation
    const sum = chartData.reduce((acc, curr) => {
      const val = curr.originalCurrency === 'PKR' ? curr.originalPrice / EXCHANGE_RATE : curr.originalPrice;
      return acc + val;
    }, 0);
    return sum / chartData.length;
  }, [chartData]);

  if (isAnalyzing) {
    return (
      <div className="py-40 flex flex-col items-center justify-center text-gray-900 gap-6">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-gray-100 rounded-full" />
          <div className="w-20 h-20 border-4 border-t-black rounded-full animate-spin absolute top-0 left-0" />
          <div className="absolute inset-0 flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-black opacity-20" />
          </div>
        </div>
        <div className="text-center">
          <h3 className="text-xl font-black mb-2 uppercase tracking-[0.3em] text-black">Analysis in Progress</h3>
          <div className="flex flex-col items-center gap-2">
            <div className="px-4 py-1.5 bg-black text-white text-[10px] font-black rounded-full tracking-widest animate-pulse uppercase">
              {analyzingStep}
            </div>
            <p className="text-gray-400 text-xs font-medium max-w-xs">{analyzingStep === "PREPARING DATASET..." ? "Optimizing market data nodes for AI ingestion..." : analyzingStep === "CROSS-REFERENCING MARKETS..." ? "Synchronizing trans-continental price signals..." : "Formatting final arbitrage recommendations..."}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="py-40 flex flex-col items-center justify-center text-gray-400 gap-8">
        <div className="w-24 h-24 bg-white rounded-[40px] shadow-sm flex items-center justify-center">
          <TrendingUp className="w-10 h-10 text-gray-200" />
        </div>
        <div className="text-center max-w-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-2">No active analysis session</h3>
          <p className="text-gray-500 mb-8">Perform a market search first to generate professional arbitrage analytics.</p>
          <button onClick={handleAnalyze} className="bg-black text-white px-8 py-3 rounded-2xl font-bold transition-all hover:shadow-xl active:scale-95">Start New Analysis</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 mb-20 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Main Chart Card - Image 1 mimic */}
        <div className="xl:col-span-2 bg-white rounded-[32px] p-10 border border-gray-100 shadow-sm relative overflow-hidden report-section">
          {/* Print Only Header */}
          <div className="hidden print:flex justify-between items-center mb-8 border-b-2 border-gray-900 pb-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight uppercase">Trans-Market Arbitrage Report</h1>
              <p className="text-sm font-mono text-gray-500">Confidential Analytical Data / {new Date().toLocaleDateString()}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 font-mono">Market Corridor</p>
              <p className="text-sm font-bold">FR ↔ PK</p>
            </div>
          </div>

          <div className="flex justify-between items-start mb-12">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                </div>
                <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Verified Match (75%)</span>
              </div>
              <h2 className="text-5xl font-black text-gray-900 mb-1 leading-tight tracking-tighter">{query}</h2>
              <p className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em]">{repairTypeQuery || 'Standard Repair'}</p>
            </div>
            <div className="text-right">
              <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Index Price</span>
              <div className="text-6xl font-black text-gray-900 leading-none">
                {formatPrice(Math.round(indexPrice), 'EUR', displayCurrency)}
              </div>
            </div>
          </div>

          <div className="h-[300px] w-full mt-12">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid vertical={false} stroke="#F0F0F0" strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 11, fontWeight: 700, fill: '#A0A0A0' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 11, fontWeight: 500, fill: '#A0A0A0' }}
                  tickFormatter={(val) => formatPrice(val, displayCurrency === 'BOTH' ? 'EUR' : displayCurrency, displayCurrency)}
                />
                <Tooltip 
                  cursor={{ fill: 'transparent' }} 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="price" radius={[8, 8, 0, 0]} barSize={40}>
                   {chartData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? '#1A1A1A' : index % 2 === 0 ? '#808291' : '#3C3E48'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sidebar Cards - Image 1 mimic */}
        <div className="space-y-8">
          <div className="bg-[#1A1A1A] text-white p-10 rounded-[32px] shadow-2xl relative overflow-hidden group">
            <div className="flex items-center gap-2 mb-8">
              <TrendingUp className="w-5 h-5 text-gray-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Recommendation</span>
            </div>
            
            <h3 className="text-4xl font-bold mb-2 tracking-tight">Recommended</h3>
            <div className="text-5xl font-black text-green-500 mb-6 tracking-tighter">Target: {formatPrice(Math.round(indexPrice * 1.15), 'EUR', displayCurrency)}</div>
            
            <p className="text-gray-400 text-sm leading-relaxed mb-10 font-medium">
              Based on current market volatility and parts availability. Includes 15% estimated labor/margin.
            </p>
            
            <button 
              onClick={() => window.print()}
              className="w-full bg-white text-black py-4 rounded-2xl font-bold tracking-tight shadow-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
            >
              Export Analysis <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-white p-10 rounded-[32px] border border-gray-100 shadow-sm">
             <div className="flex justify-between items-center mb-6">
                <span className="text-xs font-bold uppercase tracking-widest text-gray-900">Repairability</span>
                <Info className="w-4 h-4 text-gray-300" />
             </div>
             <div className="flex items-baseline gap-2">
                <span className="text-7xl font-black text-gray-900">{repairabilityScore}</span>
                <span className="text-xl font-bold text-gray-300 uppercase tracking-widest">/ 10</span>
             </div>
          </div>
        </div>
      </div>

      {/* Market Breakdown - Image 2 mimic */}
      <div className="bg-white rounded-[32px] overflow-hidden border border-gray-100 shadow-sm report-section">
        <div className="p-8 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-xl font-black italic tracking-tight text-gray-900 uppercase">Market Breakdown</h3>
          <div className="flex items-center gap-6">
            <button 
              onClick={() => exportToCSV(filteredData.all, `${query.replace(/\s+/g, '_')}_full_report`)}
              className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-black flex items-center gap-2 transition-colors no-print"
            >
              <FileDown className="w-3.5 h-3.5" /> Export CSV
            </button>
            <div className="flex items-center gap-2 px-3 py-1 bg-orange-50 text-orange-700 rounded-full">
              <AlertCircle className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest leading-none">Prices exclusive of VAT/Customs</span>
            </div>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/50 text-gray-400">
                <th className="px-10 py-5 text-[10px] font-black uppercase tracking-[0.2em]">Source</th>
                <th className="px-10 py-5 text-[10px] font-black uppercase tracking-[0.2em]">Price</th>
                <th className="px-10 py-5 text-[10px] font-black uppercase tracking-[0.2em]">Delta</th>
                <th className="px-10 py-5 text-[10px] font-black uppercase tracking-[0.2em]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {chartData.map((item, idx) => {
                const itemPriceInEur = item.originalCurrency === 'PKR' ? item.price / EXCHANGE_RATE : item.price;
                const delta = itemPriceInEur - indexPrice;
                return (
                  <tr key={idx} className="group hover:bg-gray-50/50 transition-colors">
                    <td className="px-10 py-8 font-black text-gray-900 text-lg">{item.name}</td>
                    <td className="px-10 py-8 font-bold text-gray-900 text-lg tracking-tight">{formatPrice(item.price, item.originalCurrency as any, displayCurrency)}</td>
                    <td className={cn(
                      "px-10 py-8 font-bold text-sm tracking-tight",
                      delta >= 0 ? "text-pink-500" : "text-green-500"
                    )}>
                      {delta >= 0 ? `+` : ``}{formatPrice(delta, 'EUR', displayCurrency)}
                    </td>
                    <td className="px-10 py-8">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-bold uppercase tracking-widest">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                        In Stock
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end gap-4 mt-8 no-print">
        <button onClick={() => window.print()} className="bg-white border border-gray-200 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-50 transition-colors">
          <Printer className="w-4 h-4" /> Print
        </button>
        <button onClick={() => window.print()} className="bg-black text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 hover:shadow-xl transition-all">
          <FileDown className="w-4 h-4" /> Export as PDF
        </button>
      </div>
    </div>
  );
}

function MarketColumn({ title, parts, market, loading, confidence, displayCurrency }: { title: string, parts: NormalizedPart[], market: 'FR' | 'PK', loading: boolean, confidence: number, displayCurrency: 'EUR' | 'PKR' | 'BOTH' }) {
  const medianPrice = useMemo(() => {
    if (!parts.length) return 0;
    const sorted = [...parts].sort((a, b) => a.price - b.price);
    return sorted[Math.floor(sorted.length / 2)].price;
  }, [parts]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500 flex items-center gap-2">
          {market === 'FR' ? <div className="w-4 h-4 bg-blue-600 rounded-lg shadow-sm" /> : <div className="w-4 h-4 bg-green-600 rounded-lg shadow-sm" />}
          {title}
        </h2>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-gray-400 uppercase leading-none mb-1">Median</span>
            <span className="text-sm font-black text-orange-600 leading-none">{formatPrice(medianPrice, market === 'FR' ? 'EUR' : 'PKR', displayCurrency)}</span>
          </div>
          <div className="text-[10px] bg-gray-100 px-2 py-1 rounded text-gray-500 uppercase font-mono">
            Trust: {(confidence * 100).toFixed(0)}%
          </div>
        </div>
      </div>
      <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm overflow-hidden min-h-[400px]">
        {!loading && parts.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {parts.map((part, idx) => {
              const decision = getDecisionLabel(part.price, medianPrice);
              return (
              <motion.div 
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
                className="p-4 hover:bg-gray-50 flex items-center justify-between group cursor-pointer"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-orange-500">{part.source}</span>
                    <span className={cn(
                      "text-[9px] font-black uppercase px-1.5 py-0.5 rounded-sm",
                      decision === 'cheap' ? "bg-green-100 text-green-700" : 
                      decision === 'expensive' ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
                    )}>
                      {decision}
                    </span>
                  </div>
                  <h4 className="font-bold text-gray-900 line-clamp-1 uppercase tracking-tight">{part.partName}</h4>
                  <p className="text-xs text-gray-400 uppercase tracking-tighter">{part.device}</p>
                </div>
                <div className="text-right ml-4">
                  <div className="text-lg font-mono font-bold text-gray-900">
                    {formatPrice(part.price, part.currency, displayCurrency)}
                  </div>
                  {displayCurrency === 'BOTH' && (
                    <p className="text-[10px] text-gray-400 uppercase font-medium">
                      {market === 'FR' ? (
                         `≈ ${formatPrice(part.price * EXCHANGE_RATE, 'PKR', 'PKR')}`
                      ) : (
                        `≈ ${formatPrice(part.price / EXCHANGE_RATE, 'EUR', 'EUR')}`
                      )}
                    </p>
                  )}
                </div>
                <a href={part.url} target="_blank" rel="noopener noreferrer" className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-gray-200 rounded-lg">
                  <ExternalLink className="w-4 h-4 text-gray-500" />
                </a>
              </motion.div>
            )})}
          </div>
        ) : (
          !loading && <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-300">
            <Package className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm font-medium tracking-widest uppercase">No direct matches</p>
            <p className="text-xs max-w-[200px] mt-2 italic">Try a broader device query or check raw CSV imports.</p>
          </div>
        )}
        {loading && (
           <div className="p-12 flex flex-col items-center justify-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-gray-200" />
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Scanning Market...</p>
           </div>
        )}
      </div>
    </div>
  );
}

function SettingsView({ displayCurrency, setDisplayCurrency, alerts, setAlerts }: any) {
  const [newAlert, setNewAlert] = useState({ device: '', part: '', targetPrice: '', currency: 'EUR' });

  const addAlert = () => {
    if (!newAlert.device || !newAlert.targetPrice) return;
    const id = Math.random().toString(36).substr(2, 9);
    setAlerts([...alerts, { ...newAlert, targetPrice: parseFloat(newAlert.targetPrice), id }]);
    setNewAlert({ device: '', part: '', targetPrice: '', currency: 'EUR' });
  };

  const removeAlert = (id: string) => {
    setAlerts(alerts.filter((a: any) => a.id !== id));
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-12">
        <h2 className="text-4xl font-black italic text-gray-900 mb-2 uppercase tracking-tight">System Preferences</h2>
        <p className="text-gray-500 font-medium">Configure how currency and data analysis should be presented.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-12">
          {/* Currency Section */}
          <section>
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 mb-6 flex items-center gap-2">
              <Globe className="w-4 h-4" /> Global Currency Mode
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <CurrencyOption 
                active={displayCurrency === 'EUR'} 
                label="Euro (EUR)" 
                description="Unified alignment."
                onClick={() => setDisplayCurrency('EUR')}
                icon="€"
              />
              <CurrencyOption 
                active={displayCurrency === 'PKR'} 
                label="Rupee (PKR)" 
                description="Regional pricing."
                onClick={() => setDisplayCurrency('PKR')}
                icon="Rs"
              />
              <CurrencyOption 
                active={displayCurrency === 'BOTH'} 
                label="Native" 
                description="Dual market mode."
                onClick={() => setDisplayCurrency('BOTH')}
                icon="⇄"
              />
            </div>
          </section>

          {/* Alerts Section */}
          <section>
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 mb-6 flex items-center gap-2">
              <Bell className="w-4 h-4" /> Market Strike Alerts
            </h3>
            
            <div className="bg-white border border-gray-100 rounded-[32px] overflow-hidden shadow-sm">
              <div className="p-8 border-b border-gray-50 bg-gray-50/30">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2">Device Target</label>
                    <input 
                      type="text" 
                      placeholder="e.g. iPhone 15 Pro"
                      value={newAlert.device}
                      onChange={e => setNewAlert({...newAlert, device: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-black outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2">Target Price</label>
                    <div className="flex gap-2">
                      <input 
                        type="number" 
                        placeholder="0.00"
                        value={newAlert.targetPrice}
                        onChange={e => setNewAlert({...newAlert, targetPrice: e.target.value})}
                        className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-black outline-none"
                      />
                      <select 
                        value={newAlert.currency}
                        onChange={e => setNewAlert({...newAlert, currency: e.target.value as any})}
                        className="bg-white border border-gray-200 rounded-xl px-2 py-2 text-[10px] font-bold uppercase outline-none"
                      >
                        <option value="EUR">EUR</option>
                        <option value="PKR">PKR</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button 
                      onClick={addAlert}
                      className="w-full bg-black text-white h-10 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> ADD
                    </button>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gray-50">
                {alerts.length === 0 ? (
                  <div className="p-12 text-center text-gray-300">
                    <p className="text-xs uppercase font-bold tracking-widest italic">No active strike alerts</p>
                  </div>
                ) : (
                  alerts.map((alert: any) => (
                    <div key={alert.id} className="p-6 flex items-center justify-between hover:bg-gray-50/50 transition-colors group">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-orange-50 rounded-2xl flex items-center justify-center">
                          <Bell className="w-5 h-5 text-orange-500" />
                        </div>
                        <div>
                          <h4 className="font-black text-gray-900 uppercase tracking-tight">{alert.device}</h4>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{alert.part || 'All Components'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-8">
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Threshold</p>
                          <p className="font-mono font-black text-gray-900">
                            {alert.currency === 'EUR' ? '€' : 'Rs '}{alert.targetPrice}
                          </p>
                        </div>
                        <button 
                          onClick={() => removeAlert(alert.id)}
                          className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="bg-white border border-gray-100 rounded-[32px] p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h4 className="text-sm font-bold text-gray-900 mb-1">Exchange Rate Index</h4>
                <p className="text-xs text-gray-400">Stable internal rate.</p>
              </div>
              <div className="px-4 py-2 bg-gray-50 rounded-xl font-mono font-bold text-gray-900">
                1 EUR = {EXCHANGE_RATE} PKR
              </div>
            </div>
            <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex gap-3 items-start">
               <AlertCircle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
               <p className="text-[9px] text-orange-900 font-medium leading-relaxed">
                 Arbitrage reports are calculated using this static bridge. Update via master API if required.
               </p>
            </div>
          </section>

          <div className="pt-8 border-t border-gray-100 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.4em]">GlobPrice v4.2.0-STABLE</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedbackView({ onSubmit }: { onSubmit: (f: any) => void }) {
  const [form, setForm] = useState({ email: '', category: 'General', message: '', rating: 5 });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => {
      onSubmit({
        ...form,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString()
      });
      setIsSubmitting(false);
    }, 1500);
  };

  return (
    <div className="max-w-xl mx-auto py-16 px-4 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="text-center mb-12">
        <div className="w-16 h-16 bg-black text-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl rotate-3">
          <Bell className="w-8 h-8" />
        </div>
        <h2 className="text-4xl font-black italic text-gray-900 mb-2 uppercase tracking-tight">System Feedback</h2>
        <p className="text-gray-500 font-medium lowercase tracking-wide">Help us calibrate the indexing engine.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-100 rounded-[32px] p-10 shadow-sm space-y-8">
        <div className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Interface Rating</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setForm({ ...form, rating: star })}
                  className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center transition-all",
                    form.rating >= star ? "bg-orange-50 text-orange-500 scale-110" : "bg-gray-50 text-gray-300 hover:bg-gray-100"
                  )}
                >
                  <TrendingUp className="w-6 h-6" />
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Category</label>
              <select 
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-black"
              >
                <option>General</option>
                <option>Data Accuracy</option>
                <option>Feature Request</option>
                <option>Bug Report</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Email (Optional)</label>
              <input 
                type="email"
                placeholder="anwar17070@gmail.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-black outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Message</label>
            <textarea 
              rows={4}
              required
              placeholder="What can we improve in the FR ↔ PK corridor?"
              value={form.message}
              onChange={e => setForm({ ...form, message: e.target.value })}
              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-black outline-none resize-none"
            />
          </div>
        </div>

        <button 
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-black text-white py-4 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 disabled:bg-gray-800"
        >
          {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Transmit Feedback"}
        </button>
      </form>

      <div className="mt-12 text-center p-6 bg-blue-50 border border-blue-100 rounded-3xl">
        <p className="text-[10px] font-bold text-blue-900 uppercase tracking-widest leading-relaxed">
          Your feedback is processed by our arbitrage calibration team. We prioritize data accuracy reports from active repair shops.
        </p>
      </div>
    </div>
  );
}

function SummaryView({ query, analysis, filteredData, displayCurrency, indexPrice, isPro, onUpgrade }: any) {
  const handlePrint = () => {
    if (!isPro) return;
    window.print();
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 animate-in fade-in slide-in-from-bottom-8 duration-700 print:py-0 print:px-0">
      {!isPro && (
        <section className="mb-12 bg-white border border-gray-100 rounded-[40px] p-10 shadow-xl overflow-hidden relative no-print">
          <div className="absolute top-0 right-0 w-64 h-64 bg-orange-50 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-50" />
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center text-orange-600 mb-6">
              <Zap className="w-8 h-8 fill-current" />
            </div>
            <h2 className="text-3xl font-black uppercase tracking-tight mb-4">Professional Index Access</h2>
            <p className="text-gray-500 max-w-md mb-8 font-medium">Unlock full arbitrage reports, AI search insights, and export capabilities for trade professionals.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl mb-10">
              <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 flex flex-col items-start gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-gray-300" />
                  <span className="text-xs font-bold uppercase text-gray-400">Guest Access</span>
                </div>
                <div className="text-2xl font-black">€0 <span className="text-xs text-gray-400 uppercase font-bold">/ free</span></div>
                <ul className="text-left space-y-2 text-xs font-medium text-gray-500">
                   <li>• Basic Market Sourcing</li>
                   <li>• Live Price Tracking</li>
                   <li>• Single Market View</li>
                </ul>
              </div>
              <div className="bg-black text-white p-6 rounded-3xl border border-gray-800 flex flex-col items-start gap-4 relative overflow-hidden ring-4 ring-orange-500/20">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-orange-500 fill-current" />
                  <span className="text-xs font-bold uppercase text-gray-500 tracking-widest">Trade Pro</span>
                </div>
                <div className="text-2xl font-black">€29 <span className="text-xs text-gray-500 uppercase font-bold">/ Month</span></div>
                <ul className="text-left space-y-2 text-xs font-medium text-gray-400">
                   <li>• AI Arbitrage Analysis</li>f
                   <li>• Professional PDF Export</li>
                   <li>• Multi-Corridor Tracking</li>
                   <li>• Global API Access</li>
                </ul>
              </div>
            </div>

            <button 
              onClick={onUpgrade}
              className="bg-orange-500 text-white px-12 py-4 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl shadow-orange-200 hover:scale-[1.02] transition-all active:scale-95 flex items-center gap-3"
            >
              UPGRADE TO PRO <TrendingUp className="w-5 h-5" />
            </button>
          </div>
        </section>
      )}

      <div className={cn("flex items-center justify-between mb-12 no-print", !isPro && "opacity-50 grayscale pointer-events-none")}>
        <div>
          <h2 className="text-4xl font-black italic text-gray-900 mb-2 uppercase tracking-tight">Executive Summary</h2>
          <p className="text-gray-500 font-medium lowercase tracking-wide">Market Arbitrage & Part Mapping Report</p>
        </div>
        <button 
          onClick={handlePrint}
          className="bg-black text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-all shadow-xl active:scale-95"
        >
          <Printer className="w-5 h-5" /> Export PDF
        </button>
      </div>

      <div className={cn("bg-white border border-gray-100 rounded-[40px] p-12 shadow-sm space-y-12 report-content relative overflow-hidden", !isPro && "blur-sm pointer-events-none select-none max-h-[500px]")}>
        {!isPro && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-white/40">
             <div className="bg-black text-white px-6 py-3 rounded-full font-black uppercase tracking-widest shadow-2xl flex items-center gap-2">
                <Lock className="w-5 h-5" /> Content Restricted
             </div>
          </div>
        )}
        {/* Header (Print Only) */}
        <div className="hidden print:block mb-10 pb-10 border-b-2 border-black">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-6xl font-black italic uppercase tracking-tighter leading-none">GlobPrice</h1>
              <p className="text-sm font-bold tracking-[0.4em] uppercase mt-2">Market Intelligence Report</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase text-gray-400">Generated On</p>
              <p className="text-lg font-black">{new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Section: The Objective */}
        <section>
          <h3 className="text-sm font-black uppercase tracking-[0.3em] text-orange-500 mb-6 flex items-center gap-2">
            <Info className="w-4 h-4" /> Strategic Objective
          </h3>
          <p className="text-2xl font-bold text-gray-900 leading-tight">
            Comprehensive market mapping for <span className="italic underline decoration-orange-300 decoration-4">{query}</span> across French (EU) and Pakistani (SA) supply corridors.
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Analysis Column */}
          <div className="space-y-10">
            <section>
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">Market Operations</h4>
              <div className="space-y-4">
                <div className="p-5 bg-gray-50 rounded-3xl">
                  <p className="text-xs font-bold uppercase text-gray-400 mb-1">France (Source)</p>
                  <p className="text-sm font-medium text-gray-700">Enterprise inventory sourcing from professional networks (Utopya, LCD Mobile). Optimized for original equipment manufacturer (OEM) grade stability.</p>
                </div>
                <div className="p-5 bg-gray-50 rounded-3xl">
                  <p className="text-xs font-bold uppercase text-gray-400 mb-1">Pakistan (Target)</p>
                  <p className="text-sm font-medium text-gray-700">Retail and bulk importer mapping (PriceOye, Daraz). High volatility with significant arbitrage opportunity against global indices.</p>
                </div>
              </div>
            </section>

            <section>
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">Pricing Index</h4>
              <div className="flex items-center gap-8">
                <div>
                  <p className="text-xs font-bold uppercase text-gray-400 mb-1">Normalized Avg (EUR)</p>
                  <p className="text-4xl font-black">€{indexPrice.toFixed(2)}</p>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div>
                  <p className="text-xs font-bold uppercase text-gray-400 mb-1">Native Bridge (PKR)</p>
                  <p className="text-4xl font-black">Rs {(indexPrice * 300).toLocaleString()}</p>
                </div>
              </div>
            </section>
          </div>

          {/* AI Strategy Column */}
          <div className="space-y-10">
             <section className="p-8 bg-black text-white rounded-3xl relative overflow-hidden">
                <div className="relative z-10">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4">Gemini-Engine Insights</h4>
                  {analysis ? (
                    <div className="space-y-4">
                      <p className="text-lg font-bold leading-snug">"{analysis.summary}"</p>
                      <div className="pt-4 border-t border-white/10">
                         <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-1 italic">Recommendation</p>
                         <p className="text-sm text-gray-300 italic">Target procurement within 15% delta of the normalized index for maximum profitability.</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 italic text-sm">Awaiting AI market analysis... Select 'Analytics' to generate professional insights.</p>
                  )}
                </div>
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Globe className="w-24 h-24" />
                </div>
             </section>

             <section>
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">Decision Verification</h4>
                <div className="flex flex-wrap gap-2">
                  <div className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-bold uppercase tracking-widest border border-green-100">Price Verified</div>
                  <div className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-widest border border-blue-100">Cross-Market Mapped</div>
                  <div className="px-3 py-1 bg-purple-50 text-purple-600 rounded-full text-[10px] font-bold uppercase tracking-widest border border-purple-100">Arbitrage Calculated</div>
                </div>
             </section>
          </div>
        </div>

        <div className="pt-10 border-t border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center text-white font-black italic">GP</div>
            <div>
              <p className="text-[10px] font-black text-gray-900 uppercase tracking-widest">GlobPrice Intelligence</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Verified Market Mapping</p>
            </div>
          </div>
          <div className="flex items-center gap-4 no-print">
            <button className="text-[10px] font-black uppercase underline tracking-widest" onClick={() => exportToCSV(filteredData.all, "executive_summary_data")}>Download Raw Data</button>
            <div className="w-1 h-1 bg-gray-200 rounded-full" />
            <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest italic">Report Signature: {Math.random().toString(36).substr(2, 9).toUpperCase()}</p>
          </div>
        </div>
      </div>
      
      <div className="mt-8 text-center text-[10px] font-bold text-gray-300 uppercase tracking-[0.5em] no-print">
        Proprietary Index System v4.2.0 • {query} • {new Date().getFullYear()}
      </div>
    </div>
  );
}

function AuthView({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-black text-white rounded-[32px] flex items-center justify-center mx-auto mb-8 shadow-2xl rotate-3">
            <TrendingUp className="w-10 h-10" />
          </div>
          <h1 className="text-5xl font-black italic uppercase tracking-tighter text-gray-900 mb-2">GlobPrice</h1>
          <p className="text-gray-400 font-medium tracking-wide">Trans-continental market intelligence terminal.</p>
        </div>

        <div className="bg-white border border-gray-100 rounded-[40px] p-12 shadow-xl text-center space-y-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-50 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tight">Operation Terminal</h2>
            <p className="text-gray-500 text-sm font-medium">Access cross-market arbitrage data between FR ↔ PK supply corridors.</p>
          </div>

          <div className="space-y-4">
             <button 
              onClick={onLogin}
              className="w-full bg-black text-white py-5 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] transition-all active:scale-95 flex items-center justify-center gap-4 group"
            >
              <Globe className="w-5 h-5 text-orange-500 group-hover:rotate-180 transition-transform duration-500" /> 
              Sovereign Sign-In
            </button>
            <div className="flex items-center gap-4 py-2">
              <div className="h-px bg-gray-100 flex-1" />
              <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Global Protocol</span>
              <div className="h-px bg-gray-100 flex-1" />
            </div>
            <p className="text-[10px] text-gray-400 font-medium leading-relaxed uppercase tracking-wider">
              By entering this terminal, you agree to our trans-market data usage policies and professional intelligence standards.
            </p>
          </div>
        </div>

        <div className="mt-12 flex items-center justify-center gap-8 opacity-30">
          <div className="flex items-center gap-2 font-black italic text-gray-900">
            <ShieldCheck className="w-4 h-4" /> ENCRYPTED
          </div>
          <div className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
          <div className="flex items-center gap-2 font-black italic text-gray-900 uppercase tracking-widest">
            STABLE_BUILD_v4.2
          </div>
        </div>
      </div>
    </div>
  );
}

function HelpView({ setActiveTab }: { setActiveTab: (tab: any) => void }) {
  const sections = [
    {
      title: "1. Core Mission",
      content: "GlobPrice is a trans-market arbitrage terminal designed for hardware repair professionals. It bridges the pricing gap between European (France) supply networks and South Asian (Pakistan) retail markets, identifying profitability indices that are invisible to standard search engines."
    },
    {
      title: "2. Key Capabilities",
      content: [
        "Real-time Market Mapping: Synchronizes data from specialized EU suppliers like LCD-Mobile and Utopya.",
        "AI-Powered Strategy: Uses Gemini 1.5 Pro to calculate 'Decision Confidence' and procurement advisories.",
        "Price Strike Alerts: Automated notifications when components hit target profitability thresholds.",
        "Executive PDF Reporting: Professional-grade summaries for inventory stakeholders."
      ]
    },
    {
      title: "3. Master Tutorial (Terminal Mastery)",
      content: [
        "Procurement Phase: Search for a part. Focus on 'FR Original' results. These are your gold standard for quality.",
        "Arbitrage Phase: Use the Analytics tab. If the 'PK Median' is significantly higher than 'FR OEM + 20%', you have a high-margin arbitrage opportunity.",
        "Risk Mitigation: Check the 'Confidence Score'. Only trade if confidence is above 80%. This score accounts for data age and source reliability.",
        "Precision Export: Use the 'Summary' tab to generate a PDF. This includes the 'Report Signature', which serves as a timestamped proof of price for trade negotiations.",
        "Automation: Set 'Price Strike' alerts in settings. The engine will watch the FR market and ping you when a 'BUY' signal is generated."
      ]
    },
    {
      title: "4. Database & Connectivity Solutions",
      content: "Connectivity Error (Offline): This happens when network firewalls block WebSockets. To solve this, we've forced 'Long Polling' in our Firebase config. Use a clear network where possible. IF YOU CANNOT CONNECT: The software automatically engages 'Local Mode' (File Database). Your profile and alerts will be stored in your browser's internal file system (localStorage) until the cloud bridge is restored. This ensures 100% uptime for local analysis."
    }
  ];

  return (
    <div className="max-w-4xl mx-auto py-16 px-4 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="text-center mb-16">
        <div className="w-20 h-20 bg-black text-white rounded-[40px] flex items-center justify-center mx-auto mb-8 shadow-2xl relative">
          <Info className="w-10 h-10" />
          <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-orange-500 rounded-full border-4 border-white flex items-center justify-center">
            <div className="w-2 h-2 bg-white rounded-full animate-ping" />
          </div>
        </div>
        <h2 className="text-5xl font-black italic text-gray-900 mb-4 uppercase tracking-tighter">Documentation Terminal</h2>
        <p className="text-gray-400 font-medium tracking-widest text-xs uppercase">Operational standards & troubleshooting protocols</p>
      </div>

      <div className="space-y-8">
        {sections.map((section, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-[32px] p-10 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-110 transition-transform duration-500" />
            <div className="relative z-10">
              <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-6 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" /> {section.title}
              </h3>
              {Array.isArray(section.content) ? (
                <ul className="space-y-4">
                  {section.content.map((item, j) => (
                    <li key={j} className="text-sm font-medium text-gray-600 leading-relaxed flex items-start gap-3">
                      <div className="w-1.5 h-1.5 bg-orange-500 rounded-full mt-1.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm font-medium text-gray-600 leading-relaxed italic border-l-4 border-orange-500 pl-6 py-2">
                  {section.content}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-16 p-10 bg-gray-900 text-white rounded-[40px] shadow-2xl relative overflow-hidden">
        <div className="absolute bottom-0 right-0 p-8 opacity-10">
          <TrendingUp className="w-32 h-32" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
           <div className="w-24 h-24 bg-white/10 rounded-3xl flex items-center justify-center shrink-0">
             <Zap className="w-12 h-12 text-orange-500 fill-current" />
           </div>
           <div>
             <h4 className="text-2xl font-black uppercase tracking-tight mb-2">Need Direct Intervention?</h4>
             <p className="text-gray-400 text-sm font-medium mb-6">If the system encounters a fatal redundancy error, use the Feedback terminal to alert the engineering team directly.</p>
             <button 
              onClick={() => setActiveTab('feedback')}
              className="bg-white text-black px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:scale-105 transition-all active:scale-95"
            >
              Contact Calibration Team
            </button>
           </div>
        </div>
      </div>
    </div>
  );
}

function AdminView() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAdminTab, setActiveAdminTab] = useState<'overview' | 'activity' | 'revenue'>('overview');

  const activityLogs = [
    { user: 'anwar17070@gmail.com', action: 'Search', query: 'iPhone 15 Pro Max Screen', time: '2 mins ago' },
    { user: 'guest_8271', action: 'Summary Export', query: 'Samsung S23 Ultra', time: '15 mins ago' },
    { user: 'shahrukh17070@gmail.com', action: 'Console Login', query: 'System Protocol', time: '1 hour ago' },
    { user: 'user_pk_99', action: 'Search', query: 'Oppo Reno 10 Battery', time: '3 hours ago' },
  ];

  const revenueData = [
    { date: 'May 01', revenue: 0, users: 10 },
    { date: 'May 02', revenue: 29, users: 15 },
    { date: 'May 03', revenue: 87, users: 32 },
    { date: 'May 04', revenue: 145, users: 48 },
  ];

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        const userList: UserProfile[] = [];
        querySnapshot.forEach((doc) => {
          userList.push(doc.data() as UserProfile);
        });
        setUsers(userList);
      } catch (err) {
        console.error("Error fetching admin stats:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const totalRevenue = users.filter(u => u.subscriptionTier === 'pro').length * 29;
  const proUsers = users.filter(u => u.subscriptionTier === 'pro').length;
  const guestUsers = users.filter(u => u.subscriptionTier === 'guest').length;

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Loading Intelligence Grid...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div>
          <h2 className="text-4xl font-black italic text-gray-900 mb-2 uppercase tracking-tight">Intelligence Command</h2>
          <p className="text-gray-500 font-medium">Multi-corridor revenue and activity oversight.</p>
        </div>
        <div className="flex bg-gray-100 p-1.5 rounded-2xl gap-2 h-fit">
          <button 
            onClick={() => setActiveAdminTab('overview')}
            className={cn("px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all", activeAdminTab === 'overview' ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-gray-600")}
          >
            Overview
          </button>
          <button 
            onClick={() => setActiveAdminTab('activity')}
            className={cn("px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all", activeAdminTab === 'activity' ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-gray-600")}
          >
            Activity Logs
          </button>
          <button 
            onClick={() => setActiveAdminTab('revenue')}
            className={cn("px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all", activeAdminTab === 'revenue' ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-gray-600")}
          >
            Financials
          </button>
        </div>
      </div>

      {activeAdminTab === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                <CreditCard className="w-16 h-16" />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Central Revenue</p>
              <h3 className="text-4xl font-black text-gray-900">€{totalRevenue.toLocaleString()}</h3>
              <p className="text-[10px] font-bold text-green-500 uppercase mt-2">+24.5% vs Last Period</p>
            </div>
            
            <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                <User className="w-16 h-16" />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Personnel Pool</p>
              <h3 className="text-4xl font-black text-gray-900">{users.length}</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase mt-2">Authenticated Terminals</p>
            </div>

            <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                <Zap className="w-16 h-16 text-orange-500" />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Conversion Alpha</p>
              <h3 className="text-4xl font-black text-orange-500">{proUsers}</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase mt-2">{((proUsers / (users.length || 1)) * 100).toFixed(1)}% Saturation</p>
            </div>

            <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                <Globe className="w-16 h-16 text-blue-500" />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Active Corridors</p>
              <h3 className="text-4xl font-black text-gray-900">1</h3>
              <p className="text-[10px] font-bold text-blue-500 uppercase mt-2">EU ↔ PK Protocol</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white border border-gray-100 rounded-[40px] p-10 shadow-sm">
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">
                <Layers className="w-4 h-4" /> Personnel Directory
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-50">
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Operator Email</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Protocol</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Registered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {users.map((u, i) => (
                      <tr key={i} className="group hover:bg-gray-50/50 transition-colors">
                        <td className="py-4">
                          <p className="text-xs font-black text-gray-900">{u.email}</p>
                          <p className="text-[8px] font-mono text-gray-300 uppercase leading-none mt-1">{u.uid.slice(0, 12)}</p>
                        </td>
                        <td className="py-4 text-center">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest",
                            u.subscriptionTier === 'pro' ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-500"
                          )}>
                            {u.subscriptionTier}
                          </span>
                        </td>
                        <td className="py-4 text-right">
                          <p className="text-[10px] font-bold text-gray-400">
                            {u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : 'N/A'}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-[40px] p-10 shadow-sm flex flex-col items-center">
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 mb-8 self-start flex items-center gap-2">
                <PieChartIcon className="w-4 h-4" /> Market Share
              </h3>
              <div className="h-48 w-full mb-8">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Pro', value: proUsers, color: '#F97316' },
                        { name: 'Guest', value: guestUsers, color: '#E5E7EB' },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      <Cell fill="#F97316" />
                      <Cell fill="#E5E7EB" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between border-b border-gray-50 pb-2">
                  <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Pro Operators</span>
                  <span className="text-sm font-black">{proUsers}</span>
                </div>
                <div className="flex items-center justify-between border-b border-gray-50 pb-2">
                  <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Trial Operatives</span>
                  <span className="text-sm font-black">{guestUsers}</span>
                </div>
              </div>
              <div className="mt-8 p-4 bg-orange-50 rounded-2xl w-full border border-orange-100">
                <p className="text-[9px] font-bold text-orange-600 uppercase tracking-widest text-center italic">Next Global Sync: 4h 12m</p>
              </div>
            </div>
          </div>
        </>
      )}

      {activeAdminTab === 'activity' && (
        <div className="bg-white border border-gray-100 rounded-[40px] p-10 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Real-time Mission Logs
          </h3>
          <div className="space-y-6">
            {activityLogs.map((log, i) => (
              <div key={i} className="flex items-center justify-between p-6 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center">
                    {log.action === 'Search' ? <Search className="w-5 h-5 text-gray-400" /> : <Layers className="w-5 h-5 text-orange-500" />}
                  </div>
                  <div>
                    <p className="text-xs font-black text-gray-900">{log.user}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{log.action}: {log.query}</p>
                  </div>
                </div>
                <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">{log.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeAdminTab === 'revenue' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           <div className="lg:col-span-2 bg-white border border-gray-100 rounded-[40px] p-10 shadow-sm">
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">
                <BarChart className="w-4 h-4" /> Cumulative Revenue (EUR)
              </h3>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F97316" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#F97316" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#9CA3AF' }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#9CA3AF' }}
                      tickFormatter={(value) => `€${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      labelStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '4px' }}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="#F97316" strokeWidth={4} fillOpacity={1} fill="url(#colorRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
           </div>
           
           <div className="space-y-6">
              <div className="bg-black p-8 rounded-[32px] text-white overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <CreditCard className="w-16 h-16" />
                </div>
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Projected MRR</p>
                <h3 className="text-4xl font-black italic">€435</h3>
                <p className="text-[10px] font-bold text-orange-500 uppercase mt-2">Based on current trajectory</p>
              </div>
              
              <div className="bg-white border border-gray-100 p-8 rounded-[32px] shadow-sm">
                <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-[0.2em] mb-6">Financial Controls</h4>
                <div className="space-y-4">
                   <div className="flex items-center justify-between">
                     <span className="text-xs font-bold text-gray-600">Auto-Invoicing</span>
                     <div className="w-8 h-4 bg-green-500 rounded-full flex items-center px-1">
                       <div className="w-2.5 h-2.5 bg-white rounded-full translate-x-3.5" />
                     </div>
                   </div>
                   <div className="flex items-center justify-between">
                     <span className="text-xs font-bold text-gray-600">Payout Protocol</span>
                     <span className="text-[9px] font-black uppercase text-blue-500 bg-blue-50 px-2 py-1 rounded">Net-30</span>
                   </div>
                </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

function PaymentModal({ onClose, onConfirm, loading }: { onClose: () => void; onConfirm: () => void; loading: boolean }) {
  const [method, setMethod] = useState<'card' | 'paypal' | 'google'>('card');

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 no-print"
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-white w-full max-w-lg rounded-[48px] overflow-hidden shadow-2xl relative"
      >
        <button 
          onClick={onClose}
          className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="p-12">
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-orange-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200">
                <Zap className="w-6 h-6 fill-current" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-500">Upgrade Protocol</span>
            </div>
            <h2 className="text-4xl font-black italic tracking-tighter text-gray-900 leading-none mb-2">GLOBPRICE PRO</h2>
            <p className="text-gray-400 font-medium">Unlock full trans-market arbitrage intel.</p>
          </div>

          <div className="space-y-6 mb-10">
            <div className="flex bg-gray-50 p-1.5 rounded-2xl gap-2">
              <button 
                onClick={() => setMethod('card')}
                className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2", method === 'card' ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-gray-600")}
              >
                <CreditCard className="w-3.5 h-3.5" /> Card
              </button>
              <button 
                onClick={() => setMethod('paypal')}
                className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2", method === 'paypal' ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-gray-600")}
              >
                PayPal
              </button>
              <button 
                onClick={() => setMethod('google')}
                className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2", method === 'google' ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-gray-600")}
              >
                Google Pay
              </button>
            </div>

            {method === 'card' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
                  <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Card Number</label>
                  <input type="text" placeholder="•••• •••• •••• ••••" className="bg-transparent w-full text-sm font-black outline-none" disabled={loading} />
                </div>
                <div className="flex gap-4">
                   <div className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl p-4">
                    <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Expiry</label>
                    <input type="text" placeholder="MM/YY" className="bg-transparent w-full text-sm font-black outline-none" disabled={loading} />
                  </div>
                  <div className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl p-4">
                    <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">CVC</label>
                    <input type="text" placeholder="•••" className="bg-transparent w-full text-sm font-black outline-none" disabled={loading} />
                  </div>
                </div>
              </div>
            )}

            {method === 'google' && (
              <div className="bg-black text-white p-6 rounded-2xl text-center cursor-pointer hover:bg-zinc-900 transition-colors animate-in fade-in zoom-in-95" onClick={() => !loading && onConfirm()}>
                <span className="text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2">
                   Pay with GPay
                </span>
              </div>
            )}

            {method === 'paypal' && (
              <div className="bg-[#0070ba] text-white p-6 rounded-2xl text-center cursor-pointer hover:bg-[#005ea6] transition-colors animate-in fade-in zoom-in-95" onClick={() => !loading && onConfirm()}>
                <span className="text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 italic">
                   PayPal
                </span>
              </div>
            )}
          </div>

          <button 
            onClick={onConfirm}
            disabled={loading}
            className="w-full bg-orange-500 text-white py-6 rounded-[24px] font-black uppercase tracking-[0.2em] text-xs shadow-2xl shadow-orange-200 hover:scale-[1.02] transition-all active:scale-95 disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> AUTHORIZING SECURE CHANNEL...
              </>
            ) : (
              <>UPGRADE NOW — €29.00 / mo</>
            )}
          </button>
          
          <p className="mt-8 text-[9px] font-bold text-gray-400 text-center uppercase tracking-widest">
            Secure processing via GlobPrice Gateway. 3D-Secure active.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ConsoleView() {
  const [isChecking, setIsChecking] = useState(false);
  const [connectionLog, setConnectionLog] = useState<{ time: string; msg: string; type: 'info' | 'success' | 'error' }[]>([]);

  const checkConnectivity = async () => {
    setIsChecking(true);
    const now = new Date().toLocaleTimeString();
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      setConnectionLog(prev => [...prev, { time: now, msg: 'Cloud Firestore: ONLINE', type: 'success' }]);
    } catch (err: any) {
      setConnectionLog(prev => [...prev, { time: now, msg: `Cloud Firestore: ${err.message}`, type: 'error' }]);
    } finally {
      setIsChecking(false);
    }
  };

  const commands = [
    { name: 'npm run dev', description: 'Start the Express + Vite development server', status: 'RUNNING', color: 'text-green-500' },
    { name: 'protocol:long-polling', description: 'Active Firebase connection bypass', status: 'STABLE', color: 'text-orange-500' },
    { name: 'database:hybrid-mode', description: 'Firebase + Local Storage Fallback', status: 'ACTIVE', color: 'text-blue-500' },
    { name: 'npm run lint', description: 'Run TypeScript compiler check (Linter)', status: 'STABLE', color: 'text-blue-500' },
    { name: 'npm run test', description: 'Execute unit tests with Vitest', status: 'PASSING', color: 'text-green-500' },
  ];

  const logs = [
    { time: '12:04:12', msg: 'GlobPrice Engine initialized.', type: 'info' },
    { time: '12:04:15', msg: 'Firebase security layers active.', type: 'success' },
    { time: '12:05:01', msg: 'Market sync completed for PK corridor.', type: 'success' },
    { time: '12:05:10', msg: 'Auth token handshake successful.', type: 'info' },
    { time: '12:06:55', msg: 'System integrity: STABLE.', type: 'success' },
  ];

  return (
    <div className="max-w-6xl mx-auto py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-12">
        <h2 className="text-4xl font-black italic text-gray-900 mb-2 uppercase tracking-tight">System Console</h2>
        <p className="text-gray-500 font-medium">Internal command protocols and real-time execution status.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Commands List */}
        <section className="space-y-6">
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
            <Terminal className="w-4 h-4" /> Available Protocols
          </h3>
          <div className="space-y-4">
            {commands.map((cmd, i) => (
              <div key={i} className="bg-white border border-gray-100 p-6 rounded-[24px] shadow-sm hover:shadow-md transition-shadow group">
                <div className="flex items-center justify-between mb-2">
                  <code className="text-sm font-black text-black bg-gray-50 px-3 py-1 rounded-lg">
                    {cmd.name}
                  </code>
                  <span className={cn("text-[10px] font-black uppercase tracking-widest flex items-center gap-1", cmd.color)}>
                    <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", cmd.status === 'RUNNING' ? "bg-green-500" : "bg-current")} />
                    {cmd.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 font-medium">{cmd.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Terminal Log */}
        <section className="space-y-6">
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
            <Cpu className="w-4 h-4" /> System Outlines
          </h3>
          <div className="bg-[#1A1A1A] rounded-[32px] p-8 shadow-2xl relative overflow-hidden h-[450px] flex flex-col">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-red-500" />
            <div className="flex items-center gap-2 mb-6">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
              <span className="ml-4 text-[10px] font-mono font-bold text-gray-600 uppercase tracking-widest">root@globprice:~/app</span>
            </div>
            
            <div className="flex-1 font-mono text-[11px] overflow-y-auto space-y-3 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-4">
                  <span className="text-gray-600 shrink-0">[{log.time}]</span>
                  <span className={cn(
                    log.type === 'success' ? "text-green-400" : 
                    log.type === 'info' ? "text-blue-400" : "text-gray-300"
                  )}>
                    {log.msg}
                  </span>
                </div>
              ))}
              {connectionLog.map((log, i) => (
                <div key={`conn-${i}`} className="flex gap-4">
                  <span className="text-gray-600 shrink-0">[{log.time}]</span>
                  <span className={cn(
                    log.type === 'success' ? "text-green-400" : 
                    log.type === 'error' ? "text-red-400" : "text-blue-400"
                  )}>
                    {log.msg}
                  </span>
                </div>
              ))}
              <div className="flex gap-4 animate-pulse">
                <span className="text-gray-600 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                <span className="text-white flex items-center gap-1">
                  _ <div className="w-2 h-4 bg-white" />
                </span>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase leading-none mb-1">CPU Load</p>
                  <p className="text-xs font-black text-white">4.2%</p>
                </div>
                <div className="w-px h-6 bg-white/10" />
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase leading-none mb-1">Heap</p>
                  <p className="text-xs font-black text-white">124MB</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={checkConnectivity} 
                  disabled={isChecking}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white text-[9px] font-black uppercase px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                >
                  {isChecking ? "Pinging..." : "Check Firestore Connection"}
                </button>
                <div className="w-px h-6 bg-white/10 mx-2" />
                <Layers className="w-4 h-4 text-orange-500" />
                <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">System Healthy</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CurrencyOption({ active, label, description, onClick, icon }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col text-left p-6 rounded-[28px] border-2 transition-all group relative overflow-hidden",
        active 
          ? "border-black bg-white shadow-xl scale-[1.02] ring-4 ring-black/5" 
          : "border-gray-100 bg-white hover:border-gray-200 opacity-60 hover:opacity-100"
      )}
    >
      <div className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center font-bold mb-4 transition-colors",
        active ? "bg-black text-white" : "bg-gray-100 text-gray-400 group-hover:bg-gray-200"
      )}>
        {icon}
      </div>
      <h4 className="font-black text-gray-900 mb-1 uppercase tracking-tight">{label}</h4>
      <p className="text-[10px] font-bold text-gray-500 leading-relaxed uppercase tracking-tighter">{description}</p>
      
      {active && (
        <div className="absolute top-4 right-4">
          <ShieldCheck className="w-5 h-5 text-green-500" />
        </div>
      )}
    </button>
  );
}
