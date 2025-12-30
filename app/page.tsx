"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { 
  Search, 
  Settings, 
  RefreshCw, 
  BookOpen, 
  Bookmark, 
  X, 
  ExternalLink, 
  Filter, 
  Trash2, 
  Clock,
  Newspaper,
  TrendingUp,
  Sparkles,
  MessageSquareQuote,
  Loader2
} from 'lucide-react';

// -----------------------------
// Gemini API Helper
// -----------------------------

const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";

async function callGemini(prompt: string): Promise<string> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    
    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate response.";
  } catch (e) {
    console.error("Gemini API error:", e);
    return "Unable to connect to AI service. Please try again later.";
  }
}

// -----------------------------
// Types
// -----------------------------

type Story = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string; // ISO
  excerpt?: string;
  image?: string;
  topics?: string[];
};

type HistoryEvent = {
  storyId: string;
  url: string;
  title: string;
  source: string;
  topics: string[];
  ts: number;
  action: 'open' | 'save' | 'dismiss';
};

type Prefs = {
  sourcesEnabled: Record<string, boolean>;
  mutedTopics: string[];
  view: 'for_you' | 'latest' | 'saved';
};

// -----------------------------
// Config
// -----------------------------

const DEFAULT_SOURCES = [
  { key: 'reuters', label: 'Reuters', rssUrl: 'https://feeds.reuters.com/reuters/topNews' },
  { key: 'bbc', label: 'BBC World', rssUrl: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
  { key: 'nyt', label: 'NYT World', rssUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { key: 'techcrunch', label: 'TechCrunch', rssUrl: 'https://techcrunch.com/feed/' },
  { key: 'verge', label: 'The Verge', rssUrl: 'https://www.theverge.com/rss/index.xml' },
  { key: 'sbs', label: 'SBS Australian News', rssUrl: 'https://www.sbs.com.au/news/feed' },
  { key: 'crikey', label: 'Crikey', rssUrl: 'https://www.crikey.com.au/feed/' },
];

// Personalization knobs
const PERSONALIZATION = {
  historyHalfLifeDays: 14,
  maxHistoryEvents: 2000,
  sourceBoost: 0.35,
  topicBoost: 0.7,
  recencyBoost: 0.5,
};

// -----------------------------
// Storage helpers
// -----------------------------

const LS_KEYS = {
  history: 'news_curator_history_demo',
  saves: 'news_curator_saves_demo',
  prefs: 'news_curator_prefs_demo',
};

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// -----------------------------
// Demo Data (Fallback)
// -----------------------------

const DEMO_STORIES: Story[] = [
  {
    id: 'demo-1',
    title: 'SpaceX successfully launches next-gen Starship',
    url: '#',
    source: 'TechCrunch',
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    excerpt: 'The massive rocket achieved orbit for the first time, marking a major milestone in space exploration.',
    topics: ['Space', 'Tech', 'Musk'],
    image: 'https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 'demo-2',
    title: 'Global markets rally as inflation data cools',
    url: '#',
    source: 'Reuters',
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    excerpt: 'Investors are optimistic that central banks may pause rate hikes following the latest CPI report.',
    topics: ['Economy', 'Markets', 'Finance'],
    image: 'https://images.unsplash.com/photo-1611974765270-ca1258634369?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 'demo-3',
    title: 'The hidden history of ancient coffee rituals',
    url: '#',
    source: 'BBC World',
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    excerpt: 'How a simple bean transformed societies across the Middle East and Europe.',
    topics: ['History', 'Culture', 'Food'],
    image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=800&q=80',
  },
];

// -----------------------------
// Fetch Logic (Client-side Proxy)
// -----------------------------

async function fetchStoriesFromRss(source: { key: string; label: string; rssUrl: string }): Promise<Story[]> {
  // Using rss2json public API to bypass CORS for this demo
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.rssUrl)}`;
  
  const res = await fetch(apiUrl);
  const data = await res.json();
  
  if (data.status !== 'ok') throw new Error('Failed to fetch RSS');

  return data.items.map((item: any) => ({
    id: item.guid || item.link,
    title: item.title,
    url: item.link,
    source: source.label,
    publishedAt: item.pubDate,
    excerpt: (item.description || '').replace(/<[^>]*>?/gm, '').substring(0, 150) + '...',
    image: item.thumbnail || item.enclosure?.link,
    topics: item.categories || [],
  }));
}

// -----------------------------
// Personalization Logic
// -----------------------------

function normalizeTopic(t: string) {
  return t.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildUserProfile(history: HistoryEvent[]) {
  const sourceScores: Record<string, number> = {};
  const topicScores: Record<string, number> = {};

  for (const ev of history) {
    const daysAgo = (Date.now() - ev.ts) / (1000 * 60 * 60 * 24);
    // Exponential decay
    const decay = Math.pow(0.5, daysAgo / PERSONALIZATION.historyHalfLifeDays);
    
    const actionWeight = ev.action === 'open' ? 1 : ev.action === 'save' ? 2.0 : 0.2;
    const weight = decay * actionWeight;

    sourceScores[ev.source] = (sourceScores[ev.source] || 0) + weight;
    for (const t of ev.topics) {
      const k = normalizeTopic(t);
      if (k) topicScores[k] = (topicScores[k] || 0) + weight;
    }
  }
  return { sourceScores, topicScores };
}

function scoreStory(story: Story, profile: ReturnType<typeof buildUserProfile>) {
  const daysOld = (Date.now() - new Date(story.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
  
  // Recency score (0 to 1)
  const recency = Math.max(0, 1 - daysOld / 2); 
  
  const sourceAffinity = profile.sourceScores[story.source] || 0;
  
  let topicAffinity = 0;
  for (const t of story.topics || []) {
    topicAffinity += profile.topicScores[normalizeTopic(t)] || 0;
  }

  // Tanh normalization to prevent infinite growth
  const sScore = Math.tanh(sourceAffinity) * PERSONALIZATION.sourceBoost;
  const tScore = Math.tanh(topicAffinity) * PERSONALIZATION.topicBoost;
  const rScore = recency * PERSONALIZATION.recencyBoost;

  return sScore + tScore + rScore;
}

// -----------------------------
// Components
// -----------------------------

function Button({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  disabled
}: { 
  children: React.ReactNode, 
  onClick?: () => void, 
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'magic',
  className?: string,
  disabled?: boolean
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none";
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 shadow-sm",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100",
    outline: "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 border border-red-100",
    magic: "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-md hover:opacity-90 border border-transparent"
  };

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className || ''}`}>
      {children}
    </button>
  );
}

function Badge({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) {
  return (
    <span 
      onClick={onClick}
      className={`inline-flex items-center rounded-md border border-slate-200 bg-white/50 px-2 py-1 text-xs font-medium text-slate-600 backdrop-blur-sm ${onClick ? 'cursor-pointer hover:bg-white hover:border-slate-300' : ''}`}
    >
      {children}
    </span>
  );
}

function StoryCard({ story, saved, onOpen, onSave, onDismiss, debugScore }: any) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (analysis) {
        setAnalysis(null);
        return;
    }
    
    setAnalyzing(true);
    const prompt = `
      I am reading a news story. 
      Headline: "${story.title}"
      Excerpt: "${story.excerpt}"
      Source: ${story.source}
      
      Please explain in one or two short sentences why this story might be significant or what the broader context is. 
      Focus on "why it matters". Keep it neutral and objective.
    `;
    
    const result = await callGemini(prompt);
    setAnalysis(result);
    setAnalyzing(false);
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white transition-all hover:shadow-lg hover:-translate-y-0.5">
      {story.image ? (
        <div className="relative h-48 w-full overflow-hidden bg-slate-100">
          <img 
            src={story.image} 
            alt={story.title} 
            className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-60" />
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-white">
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium backdrop-blur-md">
              {story.source}
            </span>
            <span className="flex items-center gap-1 text-xs opacity-90">
              <Clock size={12} />
              {new Date(story.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{story.source}</span>
          <span className="text-xs text-slate-400">
            {new Date(story.publishedAt).toLocaleDateString()}
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        <h3 className="mb-2 text-lg font-bold leading-tight text-slate-900 group-hover:text-blue-600 transition-colors">
          {story.title}
        </h3>
        
        {story.excerpt && (
          <p className="mb-4 line-clamp-3 text-sm text-slate-500">
            {story.excerpt}
          </p>
        )}

        {/* Gemini Analysis Block */}
        {analyzing && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-purple-50 p-3 text-xs text-purple-700 animate-pulse">
                <Sparkles size={14} className="animate-spin" /> Analyzing context...
            </div>
        )}
        
        {analysis && !analyzing && (
            <div className="mb-4 rounded-xl border border-purple-100 bg-purple-50 p-3 text-sm text-slate-700 shadow-sm">
                <div className="mb-1 flex items-center gap-1 text-xs font-bold text-purple-700">
                    <Sparkles size={12} /> AI Context
                </div>
                {analysis}
            </div>
        )}

        <div className="mt-auto flex flex-wrap gap-2 mb-4">
          {(story.topics || []).slice(0, 3).map((t: string) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
        
        {debugScore !== undefined && (
          <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <span className="font-bold">Match Score: {debugScore.toFixed(2)}</span>
            <br />
            Based on your reading history
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onOpen} variant="primary" className="flex-1">
            Read
          </Button>
          
          <button
            onClick={handleAnalyze}
            className={`rounded-xl p-2.5 transition-colors ${analysis ? 'bg-purple-100 text-purple-700' : 'bg-slate-50 text-slate-400 hover:bg-purple-50 hover:text-purple-600'}`}
            title="Get AI Context"
            disabled={analyzing}
          >
             <MessageSquareQuote size={18} />
          </button>

          <button 
            onClick={onSave}
            className={`rounded-xl p-2.5 transition-colors ${saved ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}
            title="Save for later"
          >
            <Bookmark size={18} fill={saved ? "currentColor" : "none"} />
          </button>
          <button 
            onClick={onDismiss}
            className="rounded-xl p-2.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 bg-slate-50"
            title="Dismiss"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Main App Component
// -----------------------------

export default function App() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  
  // Persisted State
  const [prefs, setPrefs] = useState<Prefs>({
    sourcesEnabled: Object.fromEntries(DEFAULT_SOURCES.map(s => [s.key, true])),
    mutedTopics: [],
    view: 'for_you'
  });
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [saves, setSaves] = useState<Record<string, Story>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  // Local State
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  
  // AI State
  const [briefing, setBriefing] = useState<string | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);

  // Load from LS on mount
  useEffect(() => {
    const savedPrefs = safeJsonParse(localStorage.getItem(LS_KEYS.prefs), null);
    if (savedPrefs) setPrefs(savedPrefs);
    
    setHistory(safeJsonParse(localStorage.getItem(LS_KEYS.history), []));
    setSaves(safeJsonParse(localStorage.getItem(LS_KEYS.saves), {}));
    
    // Initial fetch
    refreshFeeds();
  }, []);

  // Persist effects
  useEffect(() => localStorage.setItem(LS_KEYS.prefs, JSON.stringify(prefs)), [prefs]);
  useEffect(() => localStorage.setItem(LS_KEYS.history, JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem(LS_KEYS.saves, JSON.stringify(saves)), [saves]);

  const refreshFeeds = async () => {
    setLoading(true);
    try {
      // In a real app, you'd be careful about rate limits here
      const enabledSources = DEFAULT_SOURCES.filter(s => prefs.sourcesEnabled[s.key]);
      
      if (enabledSources.length === 0) {
        setStories(DEMO_STORIES);
        setLoading(false);
        return;
      }

      const promises = enabledSources.map(s => fetchStoriesFromRss(s).catch(e => {
        console.warn(`Failed to fetch ${s.label}`, e);
        return [];
      }));

      const results = await Promise.all(promises);
      const flattened = results.flat();
      
      // Dedupe by URL
      const unique = Array.from(new Map(flattened.map(item => [item.url, item])).values());
      
      setStories(unique.length > 0 ? unique : DEMO_STORIES);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error(err);
      setStories(DEMO_STORIES);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = (story: Story, action: 'open' | 'save' | 'dismiss') => {
    // Record history
    const event: HistoryEvent = {
      storyId: story.id,
      url: story.url,
      title: story.title,
      source: story.source,
      topics: story.topics || [],
      ts: Date.now(),
      action
    };
    setHistory(prev => [...prev, event]);

    if (action === 'open') {
      window.open(story.url, '_blank');
    } else if (action === 'save') {
      setSaves(prev => {
        const next = { ...prev };
        if (next[story.id]) delete next[story.id];
        else next[story.id] = story;
        return next;
      });
    } else if (action === 'dismiss') {
      setDismissed(prev => ({ ...prev, [story.id]: true }));
    }
  };

  // -----------------------------
  // Filtering & Ranking Logic
  // -----------------------------

  const userProfile = useMemo(() => buildUserProfile(history), [history]);

  const displayedStories = useMemo(() => {
    let pool = prefs.view === 'saved' 
      ? Object.values(saves) 
      : stories.filter(s => !dismissed[s.id]);

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      pool = pool.filter(s => 
        s.title.toLowerCase().includes(q) || 
        s.source.toLowerCase().includes(q)
      );
    }

    // Muted Topics filter
    if (prefs.mutedTopics.length > 0) {
      pool = pool.filter(s => 
        !(s.topics || []).some(t => prefs.mutedTopics.includes(normalizeTopic(t)))
      );
    }

    // Ranking / Sorting
    if (prefs.view === 'for_you') {
      // Add scores and sort
      return pool.map(s => ({
        ...s,
        _score: scoreStory(s, userProfile)
      })).sort((a, b) => b._score - a._score);
    } else {
      // Latest or Saved: just sort by date
      return pool.sort((a, b) => 
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
    }
  }, [stories, saves, dismissed, prefs.view, prefs.mutedTopics, searchQuery, userProfile]);

  // -----------------------------
  // AI Handlers
  // -----------------------------
  
  const generateBriefing = async () => {
    if (displayedStories.length === 0) return;
    setGeneratingBriefing(true);
    setBriefing(null);
    
    // Take top 8 stories max
    const topStories = displayedStories.slice(0, 8);
    const context = topStories.map(s => `- ${s.title} (${s.source})`).join('\n');
    
    const prompt = `
      You are a professional news anchor providing a "Morning Briefing".
      Here are the top headlines for this user:
      ${context}
      
      Synthesize these into a single, cohesive paragraph (about 3-4 sentences) summarizing the key themes or most important events. 
      Do not just list the titles. Make it sound engaging and professional.
    `;
    
    const result = await callGemini(prompt);
    setBriefing(result);
    setGeneratingBriefing(false);
  };

  // -----------------------------
  // Layout
  // -----------------------------

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 text-slate-900 md:flex-row font-sans">
      
      {/* Mobile Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4 md:hidden">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">N</div>
          <span>News Curator</span>
        </div>
        <button onClick={() => setShowSidebar(!showSidebar)} className="p-2 text-slate-600">
          <Settings size={20} />
        </button>
      </div>

      {/* Sidebar / Settings Panel */}
      <aside className={`
        fixed inset-y-0 left-0 z-20 w-80 transform overflow-y-auto border-r border-slate-200 bg-white p-6 transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="mb-8 hidden items-center gap-2 font-bold text-slate-900 md:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">N</div>
          <span className="text-xl">News Curator</span>
        </div>

        <div className="space-y-8">
          {/* Feed Selector */}
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Your Feed</h3>
            <div className="flex flex-col gap-1">
              <button 
                onClick={() => setPrefs(p => ({ ...p, view: 'for_you' }))}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${prefs.view === 'for_you' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <TrendingUp size={18} /> For You
              </button>
              <button 
                onClick={() => setPrefs(p => ({ ...p, view: 'latest' }))}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${prefs.view === 'latest' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Newspaper size={18} /> Latest News
              </button>
              <button 
                onClick={() => setPrefs(p => ({ ...p, view: 'saved' }))}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${prefs.view === 'saved' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Bookmark size={18} /> Saved ({Object.keys(saves).length})
              </button>
            </div>
          </div>

          {/* Sources */}
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Sources</h3>
            <div className="space-y-2">
              {DEFAULT_SOURCES.map(source => (
                <label key={source.key} className="flex items-center justify-between rounded-lg p-2 hover:bg-slate-50 cursor-pointer">
                  <span className="text-sm font-medium text-slate-700">{source.label}</span>
                  <input 
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={prefs.sourcesEnabled[source.key]}
                    onChange={(e) => setPrefs(p => ({
                      ...p,
                      sourcesEnabled: { ...p.sourcesEnabled, [source.key]: e.target.checked }
                    }))}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Data Controls */}
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Data & Privacy</h3>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-xs text-slate-500">
                This demo stores your history locally in your browser to calculate the "For You" ranking.
              </div>
              <div className="flex flex-col gap-2">
                 <div className="flex justify-between text-xs font-medium text-slate-700">
                    <span>History Events</span>
                    <span>{history.length}</span>
                 </div>
                 <Button 
                   variant="outline" 
                   onClick={() => { setHistory([]); setSaves({}); setDismissed({}); }}
                   className="w-full text-xs"
                 >
                   <Trash2 size={14} /> Clear All Data
                 </Button>
              </div>
            </div>
          </div>
        </div>
      </aside>
      
      {/* Overlay for mobile sidebar */}
      {showSidebar && (
        <div 
          className="fixed inset-0 z-10 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-6 md:p-10">
          
          {/* Header Area */}
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                {prefs.view === 'for_you' ? 'Top Picks For You' : prefs.view === 'latest' ? 'Latest Headlines' : 'Reading List'}
              </h1>
              <p className="mt-1 text-slate-500">
                {prefs.view === 'for_you' 
                  ? 'Curated based on your local reading history.' 
                  : `Showing ${displayedStories.length} stories.`}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Magic Briefing Button */}
               <Button 
                 variant="magic" 
                 onClick={generateBriefing} 
                 disabled={generatingBriefing || displayedStories.length === 0}
                 className="hidden md:flex"
               >
                 {generatingBriefing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                 Smart Briefing
               </Button>
            
              <div className="relative group hidden md:block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500" />
                <input 
                  type="text" 
                  placeholder="Filter stories..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none ring-offset-2 transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 md:w-64"
                />
              </div>
              <Button 
                variant="outline" 
                onClick={refreshFeeds} 
                className="h-10 w-10 p-0"
                disabled={loading}
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </Button>
            </div>
          </div>
          
           {/* Briefing Display Area */}
           {briefing && (
             <div className="mb-8 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-700 p-6 text-white shadow-lg animate-in fade-in slide-in-from-top-4">
                <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-indigo-200 text-xs">
                        <Sparkles size={14} /> AI Executive Summary
                    </div>
                    <button onClick={() => setBriefing(null)} className="rounded-full bg-white/10 p-1 hover:bg-white/20">
                        <X size={14} />
                    </button>
                </div>
                <p className="text-lg leading-relaxed font-medium">
                    {briefing}
                </p>
             </div>
           )}

          {/* Stories Grid */}
          {loading && displayedStories.length === 0 ? (
             <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
               {[1, 2, 3, 4, 5, 6].map(i => (
                 <div key={i} className="h-80 animate-pulse rounded-3xl bg-slate-200"></div>
               ))}
             </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {displayedStories.map((story: any) => (
                <StoryCard 
                  key={story.id} 
                  story={story} 
                  saved={!!saves[story.id]}
                  debugScore={prefs.view === 'for_you' ? story._score : undefined}
                  onOpen={() => handleAction(story, 'open')}
                  onSave={() => handleAction(story, 'save')}
                  onDismiss={() => handleAction(story, 'dismiss')}
                />
              ))}
              
              {displayedStories.length === 0 && (
                <div className="col-span-full py-20 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <BookOpen size={32} />
                  </div>
                  <h3 className="text-lg font-medium text-slate-900">No stories found</h3>
                  <p className="text-slate-500">Try adjusting your search or enabling more sources.</p>
                  <Button variant="outline" onClick={() => { setSearchQuery(''); setPrefs(p => ({...p, view: 'latest'})) }} className="mt-4">
                    Reset Filters
                  </Button>
                </div>
              )}
            </div>
          )}
          
          <div className="mt-12 text-center text-xs text-slate-400">
            {lastRefreshed && (
               <span>Last updated: {lastRefreshed.toLocaleTimeString()} • </span>
            )}
            <span>Powered by rss2json • Privacy: Data stays in your browser.</span>
          </div>

        </div>
      </main>
    </div>
  );
}