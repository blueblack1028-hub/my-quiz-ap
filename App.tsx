import React, { useState, useEffect, useRef } from 'react';
import { 
  Languages, 
  ArrowLeftRight, 
  Mic, 
  Image as ImageIcon, 
  Copy, 
  Volume2, 
  RotateCcw, 
  Send,
  Loader2,
  X,
  Plus,
  LogOut,
  History,
  User as UserIcon,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { cn } from './lib/utils';
import { translateText, translateImage, translateAudio, textToSpeech } from './services/gemini';
import { useAuth } from './contexts/AuthContext';
import { db } from './lib/firebase';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';

const languages = [
  { code: 'auto', name: 'دیاریکردنی خۆکار', native: 'Detect Language' },
  { code: 'ckb', name: 'کوردی (سۆرانی)', native: 'Kurdish (Sorani)' },
  { code: 'kmr', name: 'کوردی (کرمانجی)', native: 'Kurdish (Kurmanji)' },
  { code: 'en', name: 'ئینگلیزی', native: 'English' },
  { code: 'ar', name: 'عەرەبی', native: 'Arabic' },
  { code: 'fa', name: 'فارسی', native: 'Persian' },
  { code: 'tr', name: 'تورکی', native: 'Turkish' },
  { code: 'fr', name: 'فەڕەنسی', native: 'French' },
  { code: 'de', name: 'ئەڵمانی', native: 'German' },
  { code: 'es', name: 'ئیسپانی', native: 'Spanish' },
];

export default function App() {
  const { user, login, logout } = useAuth();
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('ckb');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [imageBlocks, setImageBlocks] = useState<any[]>([]);
  
  const [activeTab, setActiveTab] = useState<'text' | 'image' | 'audio' | 'history'>('text');
  const translationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'history'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setHistory(items);
    });

    return () => unsubscribe();
  }, [user]);

  const saveToHistory = async (source: string, result: string, type: string) => {
    if (!user || !source.trim() || !result.trim()) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'history'), {
        userId: user.uid,
        sourceText: source,
        translatedText: result,
        fromLang: sourceLang,
        toLang: targetLang,
        type,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Error saving history:", e);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'history', id));
    } catch (e) {
      console.error("Error deleting history:", e);
    }
  };

  const handleTranslate = async (textToTranslate: string = inputText) => {
    if (!textToTranslate.trim()) {
      setTranslatedText('');
      return;
    }
    setIsLoading(true);
    try {
      const from = languages.find(l => l.code === sourceLang)?.native || sourceLang;
      const to = languages.find(l => l.code === targetLang)?.native || targetLang;
      const result = await translateText(textToTranslate, from, to);
      setTranslatedText(result);
      if (textToTranslate === inputText) { // Only save if it's the main input
        saveToHistory(textToTranslate, result, 'text');
      }
    } catch (error) {
      console.error(error);
      // alert('هەڵەیەک ڕوویدا لە کاتی وەرگێڕان');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (translationTimeoutRef.current) {
      clearTimeout(translationTimeoutRef.current);
    }

    translationTimeoutRef.current = setTimeout(() => {
      handleTranslate();
    }, 800);

    return () => {
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current);
      }
    };
  }, [inputText, sourceLang, targetLang, activeTab]);

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      setImagePreview(reader.result as string);
      setImageBlocks([]);
      processImageTranslation(base64, file.type);
    };
    reader.readAsDataURL(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'image/*': [] },
    multiple: false 
  } as any); // Use any to bypass strict type check for now if lib version mismatch

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setIsLoading(true);
          try {
            const to = languages.find(l => l.code === targetLang)?.native || targetLang;
            const result = await translateAudio(base64, 'audio/webm', to);
            
            // Show transcription in the input area and translation in the output
            if (result.transcription) {
              setInputText(result.transcription);
            }
            setTranslatedText(result.translation);
            saveToHistory(result.transcription || "Audio Transcription", result.translation, 'audio');
          } catch (error) {
            console.error(error);
            alert('هەڵەیەک ڕوویدا لە کاتی وەرگێڕانی دەنگ');
          } finally {
            setIsLoading(false);
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      alert('پێویستە مۆڵەتی مایکرۆفۆن بدەیت');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const toggleRecording = () => {
    setActiveTab('audio');
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const swapLanguages = () => {
    if (sourceLang !== 'auto') {
      const temp = sourceLang;
      setSourceLang(targetLang);
      setTargetLang(temp);
      setInputText(translatedText);
      setTranslatedText(inputText);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Optional: show toast
  };

  const handleSpeak = async () => {
    if (!translatedText || isSpeaking) return;
    setIsSpeaking(true);
    try {
      const audioUrl = await textToSpeech(translatedText);
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audio.onended = () => setIsSpeaking(false);
        audio.play();
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error(error);
      setIsSpeaking(false);
    }
  };

  const startCamera = async () => {
    setIsCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error(err);
      alert('پێویستە مۆڵەتی کامێرا بدەیت');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setImagePreview(dataUrl);
        setImageBlocks([]);
        
        // Pass to GEMINI
        const base64 = dataUrl.split(',')[1];
        processImageTranslation(base64, 'image/jpeg');
      }
      stopCamera();
    }
  };

  const processImageTranslation = async (base64: string, mimeType: string) => {
    setIsLoading(true);
    try {
      const to = languages.find(l => l.code === targetLang)?.native || targetLang;
      const result = await translateImage(base64, mimeType, to);
      if (result.detectedText) {
        setInputText(result.detectedText);
      }
      setTranslatedText(result.translation);
      setImageBlocks(result.blocks || []);
      saveToHistory(result.detectedText || "Image Text", result.translation, 'image');
    } catch (error) {
      console.error(error);
      alert('هەڵەیەک ڕوویدا لە کاتی وەرگێڕانی وێنە');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans overflow-x-hidden" dir="rtl">
      {/* Editorial Navigation */}
      <nav className="h-16 md:h-20 border-b border-slate-200 flex items-center justify-between px-4 md:px-10 bg-white z-10 flex-shrink-0">
        <div className="flex items-center gap-4 md:gap-10">
          <div className="text-xl md:text-2xl font-black tracking-tighter text-indigo-600 flex items-center gap-2">
            <Languages className="w-6 h-6 md:w-7 md:h-7" />
            وەرگێر
          </div>
          <div className="hidden lg:flex gap-8 text-sm font-bold text-slate-500">
            <span 
              onClick={() => setActiveTab('text')}
              className={cn("cursor-pointer transition-colors hover:text-slate-900", activeTab !== 'history' ? "text-slate-900 border-b-2 border-indigo-600 pb-1" : "")}
            >
              دەستپێک
            </span>
            <span 
              onClick={() => setActiveTab('history')}
              className={cn("cursor-pointer transition-colors hover:text-slate-900", activeTab === 'history' ? "text-slate-900 border-b-2 border-indigo-600 pb-1" : "")}
            >
              مێژوو
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold leading-none">{user.displayName || 'بەکارھێنەری کوردی'}</p>
                <p className="text-[10px] text-slate-400">ئەکاونتی پڕۆ</p>
              </div>
              <div className="flex items-center gap-3">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-9 h-9 rounded-full border border-slate-200 object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                    <UserIcon className="w-5 h-5" />
                  </div>
                )}
                <button 
                  onClick={logout}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  title="چوونەدەرەوە"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            <button 
              onClick={login}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-full text-sm font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95"
            >
              <UserIcon className="w-4 h-4" />
              چوونەژوورەوە
            </button>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 flex flex-col lg:grid lg:grid-cols-12 gap-6 md:gap-8 overflow-y-auto lg:overflow-hidden bg-slate-50 lg:max-w-7xl lg:mx-auto w-full">
        {/* Sidebar Tools - Horizontal on mobile/tablet, Vertical on desktop */}
        <aside className="lg:col-span-2 flex flex-row lg:flex-col gap-3 md:gap-4 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 scrollbar-hide">
          <button 
            onClick={() => setActiveTab('text')}
            className={cn(
              "editorial-sidebar-btn flex-1 lg:flex-none py-3 px-4 min-w-[100px] lg:min-w-0 justify-center lg:justify-start",
              activeTab === 'text' ? "editorial-sidebar-btn-active" : "editorial-sidebar-btn-inactive"
            )}
          >
            <Plus className="w-5 h-5 md:w-6 md:h-6" />
            <span className="text-xs md:text-sm font-bold">تێکست</span>
          </button>
          
          <div {...getRootProps()} className="flex-1 lg:flex-none">
            <input {...getInputProps()} />
            <button 
              onClick={() => setActiveTab('image')}
              className={cn(
                "editorial-sidebar-btn w-full py-3 px-4 min-w-[100px] lg:min-w-0 justify-center lg:justify-start",
                activeTab === 'image' ? "editorial-sidebar-btn-active" : "editorial-sidebar-btn-inactive"
              )}
            >
              <ImageIcon className="w-5 h-5 md:w-6 md:h-6" />
              <div className="flex flex-col items-start">
                <span className="text-xs md:text-sm font-bold">وێنە</span>
                <span className="text-[10px] opacity-50 hidden lg:block tracking-tighter">دابەزاندن یان گرتن</span>
              </div>
            </button>
          </div>

          <button 
            onClick={toggleRecording}
            className={cn(
              "editorial-sidebar-btn flex-1 lg:flex-none py-3 px-4 min-w-[100px] lg:min-w-0 justify-center lg:justify-start",
              isRecording ? "bg-red-500 text-white animate-pulse" : 
              activeTab === 'audio' ? "editorial-sidebar-btn-active" : "editorial-sidebar-btn-inactive"
            )}
          >
            <Mic className="w-5 h-5 md:w-6 md:h-6" />
            <span className="text-xs md:text-sm font-bold">دەنگ</span>
          </button>

          <button 
            onClick={() => setActiveTab('history')}
            className={cn(
              "editorial-sidebar-btn flex-1 lg:flex-none py-3 px-4 min-w-[100px] lg:min-w-0 justify-center lg:justify-start",
              activeTab === 'history' ? "editorial-sidebar-btn-active" : "editorial-sidebar-btn-inactive"
            )}
          >
            <History className="w-5 h-5 md:w-6 md:h-6" />
            <span className="text-xs md:text-sm font-bold">مێژوو</span>
          </button>

          <div className="mt-auto hidden lg:block p-5 bg-slate-900 text-white rounded-3xl overflow-hidden relative group cursor-pointer">
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-indigo-500/20 rounded-full blur-2xl group-hover:bg-indigo-500/40 transition-colors" />
            <p className="text-[10px] uppercase tracking-widest opacity-60 mb-2 font-bold">نوێکردنەوە</p>
            <p className="text-xs font-medium leading-relaxed">بەکارھێنانی ژیری دەستکرد بۆ وەرگێڕانی وێنە و دەنگ چالاک کرا.</p>
          </div>
        </aside>

        {/* Translation Interface */}
        <div className="lg:col-span-10 flex flex-col gap-4 md:gap-6 overflow-visible lg:overflow-hidden">
          {activeTab === 'history' ? (
            <div className="flex-1 flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">مێژووی وەرگێڕانەکان</h2>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{history.length} دانە</span>
              </div>
              
              {!user ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white rounded-[2.5rem] border border-slate-200 text-center">
                  <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-6">
                    <History className="w-10 h-10" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">تکایە بچۆ ژوورەوە</h3>
                  <p className="text-slate-500 max-w-sm mb-8">بۆ ئەوەی مێژووی وەرگێڕانەکانت ببینی و پاشەکەوتیان بکەیت، پێویستە بچیتە ناو ئەکاونتەکەت.</p>
                  <button onClick={login} className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all">چوونەژوورەوە</button>
                </div>
              ) : history.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white rounded-[2.5rem] border border-slate-200 text-center">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6">
                    <History className="w-10 h-10" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">مێژوو خاڵییە</h3>
                  <p className="text-slate-500">هێشتا هیچ وەرگێڕانێکت ئەنجام نەداوە.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                  {history.map((item: any) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={item.id}
                      className="bg-white p-5 md:p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all group"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 px-2 py-0.5 bg-indigo-50 rounded-md">
                            {item.type}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">
                            {item.createdAt?.toDate().toLocaleDateString('ku-IQ')}
                          </span>
                        </div>
                        <button 
                          onClick={() => deleteHistoryItem(item.id)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{item.fromLang}</p>
                          <p className="text-sm md:text-base text-slate-600 line-clamp-3">{item.sourceText}</p>
                        </div>
                        <div className="border-t md:border-t-0 md:border-r border-slate-100 pt-4 md:pt-0 md:pr-6">
                          <p className="text-[10px] font-bold text-indigo-400 mb-1 uppercase tracking-wider">{item.toLang}</p>
                          <p className="text-sm md:text-base text-slate-900 font-bold line-clamp-3">{item.translatedText}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setInputText(item.sourceText);
                          setTranslatedText(item.translatedText);
                          setSourceLang(item.fromLang);
                          setTargetLang(item.toLang);
                          setActiveTab('text');
                        }}
                        className="mt-4 w-full py-2 bg-slate-50 text-slate-400 text-xs font-bold rounded-xl hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                      >
                        بەکارهێنانەوەی ئەم دەقە
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Language Selector */}
          <div className="flex items-center gap-2 md:gap-4 bg-white p-1.5 md:p-2 rounded-full border border-slate-200 shadow-sm">
            <div className="flex-1 relative">
              <select 
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full py-2.5 md:py-3 px-2 md:px-6 rounded-full bg-slate-50 font-bold text-xs md:text-sm appearance-none focus:ring-1 focus:ring-indigo-100 outline-none text-center cursor-pointer border-none truncate"
              >
                {languages.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.name}</option>
                ))}
              </select>
            </div>
            
            <button 
              onClick={swapLanguages}
              className="p-2 md:p-2.5 bg-indigo-50 rounded-full text-indigo-600 hover:bg-indigo-100 transition-colors flex-shrink-0"
            >
              <ArrowLeftRight className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            
            <div className="flex-1 relative">
              <select 
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full py-2.5 md:py-3 px-2 md:px-6 rounded-full bg-slate-50 font-bold text-xs md:text-sm appearance-none focus:ring-1 focus:ring-indigo-100 outline-none text-center cursor-pointer border-none truncate"
              >
                {languages.filter(l => l.code !== 'auto').map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Input/Output Area */}
          <div className="flex flex-col md:grid md:grid-cols-2 flex-1 gap-4 md:gap-6 min-h-0">
            {/* Input Panel */}
            <div className="editorial-card border-2 border-indigo-100/50 p-5 md:p-8 flex flex-col relative min-h-[250px] md:min-h-0">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={activeTab === 'audio' ? "دەنگی وەرگێڕدراو لێرە دەردەکەوێت..." : "لێرە بنووسە بۆ وەرگێڕان..."}
                className="w-full flex-1 resize-none border-none focus:ring-0 text-lg md:text-xl placeholder:text-slate-300 font-medium leading-relaxed"
              />
              
              <AnimatePresence>
                {activeTab === 'audio' && !isRecording && !inputText && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-white/50 backdrop-blur-sm z-10"
                  >
                    <button 
                      onClick={toggleRecording}
                      className="w-24 h-24 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-2xl shadow-indigo-200 hover:scale-105 active:scale-95 transition-all mb-6"
                    >
                      <Mic className="w-10 h-10" />
                    </button>
                    <p className="text-slate-900 font-black text-lg">وەرگێڕانی دەنگ</p>
                    <p className="text-slate-500 text-sm mt-1">کرتە لە مایکرۆفۆنەکە بکە بۆ دەستپێکردن</p>
                  </motion.div>
                )}
                {imagePreview && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute inset-2 md:inset-4 bg-white rounded-2xl flex flex-col items-center justify-center p-4 md:p-8 z-20 shadow-2xl border border-slate-100 overflow-hidden"
                  >
                    <div className="relative w-full flex-1 flex flex-col items-center justify-center min-h-0">
                      <img src={imagePreview} alt="Preview" className="max-h-full rounded-xl shadow-lg ring-1 ring-slate-200 object-contain" />
                      
                      {isLoading && (
                        <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center rounded-xl">
                          <div className="flex flex-col items-center gap-3">
                            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                            <span className="text-xs font-bold text-slate-900">لە وەرگێڕاندایە...</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-6 flex gap-3 w-full justify-center">
                      <button 
                        onClick={() => { setImagePreview(null); setImageBlocks([]); setInputText(''); setTranslatedText(''); }}
                        className="px-6 py-2.5 bg-red-50 text-red-600 rounded-xl text-xs md:text-sm font-bold hover:bg-red-100 transition-colors"
                      >
                        سڕینەوە
                      </button>
                      <button 
                        onClick={() => setImagePreview(null)}
                        className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs md:text-sm font-bold shadow-lg hover:bg-indigo-700 transition-all"
                      >
                        بینینی ئەنجام
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-between items-center pt-4 md:pt-6 border-t border-slate-100 mt-2 md:mt-4">
                <span className="text-[10px] md:text-xs text-slate-400 font-mono font-bold">{inputText.length} / 5000</span>
                <div className="flex items-center gap-3">
                  {isLoading && (
                    <span className="text-[10px] text-indigo-400 font-bold animate-pulse">وەرگێڕانی خۆکار...</span>
                  )}
                  <div className="w-8 h-8 rounded-full border border-slate-100 flex items-center justify-center text-slate-300">
                    <RotateCcw 
                      className="w-4 h-4 cursor-pointer hover:text-indigo-600 transition-colors" 
                      onClick={() => { setInputText(''); setTranslatedText(''); }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Output Panel */}
            <div className="editorial-output p-5 md:p-8 flex flex-col relative overflow-hidden min-h-[150px] md:min-h-0">
              <div className="absolute top-0 right-0 w-32 md:w-48 h-32 md:h-48 bg-indigo-500/10 blur-[60px] md:blur-[80px]"></div>
              
              <div className="flex-1 text-lg md:text-xl font-medium leading-relaxed opacity-90 overflow-y-auto">
                {isLoading && !translatedText ? (
                  <div className="h-full flex items-center justify-center opacity-40">
                    <Loader2 className="w-8 h-8 md:w-10 md:h-10 animate-spin" />
                  </div>
                ) : (
                  translatedText || <span className="opacity-30 italic text-sm md:text-xl">ئەنجامی وەرگێڕان لێرە دەردەکەوێت...</span>
                )}
              </div>

              <div className="flex justify-between items-center pt-4 md:pt-6 border-t border-white/10 mt-2 md:mt-4 z-10">
                <div className="flex gap-2 md:gap-4">
                  <button 
                    onClick={() => copyToClipboard(translatedText)}
                    disabled={!translatedText}
                    className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold bg-white/10 px-3 md:px-4 py-1.5 md:py-2 rounded-full hover:bg-white/20 transition-colors disabled:opacity-30"
                  >
                    <Copy className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    کۆپی
                  </button>
                  <button 
                    onClick={handleSpeak}
                    disabled={!translatedText || isSpeaking}
                    className={cn(
                      "flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold bg-white/10 px-3 md:px-4 py-1.5 md:py-2 rounded-full transition-all disabled:opacity-30",
                      isSpeaking ? "bg-indigo-500/30 ring-2 ring-indigo-500/50" : "hover:bg-white/20"
                    )}
                  >
                    <Volume2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    بیستن
                  </button>
                </div>
                <div className="text-[9px] md:text-[11px] text-white/30 italic font-medium">وەرگێڕدراوە لەلایەن AI</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  </main>

      {/* Camera Modal Overlay */}
      <AnimatePresence>
        {isCameraActive && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl z-[150] flex flex-col items-center justify-center p-4"
          >
            <div className="w-full max-w-lg aspect-square bg-black rounded-3xl overflow-hidden relative shadow-2xl">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 border-[40px] border-black/20 pointer-events-none" />
              <div className="absolute top-4 right-4">
                <button 
                  onClick={stopCamera}
                  className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            
            <div className="mt-10 flex items-center gap-10">
              <button 
                onClick={capturePhoto}
                className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all"
              >
                <div className="w-16 h-16 border-4 border-slate-900 rounded-full" />
              </button>
            </div>
            <p className="mt-6 text-white/50 text-sm font-bold">وێنەیەک بگرە بۆ وەرگێڕان</p>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Voice Overlay */}
      <AnimatePresence>
        {isRecording && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 md:p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-[2rem] md:rounded-[3rem] p-8 md:p-12 flex flex-col items-center shadow-3xl max-w-sm w-full border border-slate-100"
            >
              <div className="relative">
                <motion.div 
                  animate={{ scale: [1, 1.4, 1], opacity: [0.2, 0, 0.2] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-4 bg-indigo-500 rounded-full"
                />
                <button 
                  onClick={stopRecording}
                  className="relative bg-indigo-600 p-8 md:p-10 rounded-full shadow-2xl shadow-indigo-600/40 hover:scale-105 active:scale-95 transition-all text-white cursor-pointer group"
                >
                  <Mic className="w-8 h-8 md:w-10 md:h-10 transition-transform group-hover:rotate-12" />
                </button>
              </div>
              <h2 className="mt-8 md:mt-10 text-xl md:text-2xl font-black text-slate-900 tracking-tight">گوێ دەگرم...</h2>
              <p className="mt-2 md:mt-3 text-slate-500 font-bold text-xs md:text-sm">بۆ وەستان کلیک لە مایکرۆفۆنەکە بکە</p>
              
              <button 
                onClick={stopRecording}
                className="mt-10 md:mt-12 px-8 md:px-10 py-3 md:py-4 bg-red-600 text-white rounded-2xl font-black text-xs md:text-sm tracking-widest uppercase hover:bg-red-700 transition-all shadow-xl active:scale-95 flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                وەستان
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
