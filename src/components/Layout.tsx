import React from 'react';
import { User, Heart, Bell, PieChart, Landmark, BarChart3, Settings as SettingsIcon } from 'lucide-react';
import { View } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentView: View;
  onViewChange: (view: View) => void;
  showFavoritesOnly?: boolean;
  onToggleFavoritesOnly?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ 
  children, 
  currentView, 
  onViewChange,
  showFavoritesOnly = false,
  onToggleFavoritesOnly
}) => {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full top-0 sticky z-40 bg-surface/90 backdrop-blur-md border-b border-outline-variant/20">
        <div className="flex justify-between items-center px-4 py-4 w-full mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden border border-outline-variant/10">
              <img 
                alt="User profile" 
                className="w-full h-full object-cover" 
                src="https://picsum.photos/seed/user123/100/100"
                referrerPolicy="no-referrer"
              />
            </div>
            <h1 className="font-headline font-extrabold text-primary text-2xl tracking-tight">NetFlow</h1>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={onToggleFavoritesOnly}
              className={`p-2 hover:bg-surface-container-high rounded-full transition-colors ${showFavoritesOnly ? 'text-red-500 bg-red-50' : 'text-on-surface-variant'}`}
            >
              <Heart size={22} fill={showFavoritesOnly ? "currentColor" : "none"} />
            </button>
            <button className="p-2 hover:bg-surface-container-high rounded-full transition-colors text-on-surface-variant">
              <Bell size={22} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pb-24 md:pb-12">
        {children}
      </main>

      {/* Bottom Nav (Mobile) */}
      <nav className="fixed bottom-0 left-0 w-full z-50 md:hidden">
        <div className="bg-surface/95 backdrop-blur-xl border-t border-outline-variant/30 flex justify-around items-center px-2 pb-8 pt-3">
          <button 
            onClick={() => onViewChange('portfolio')}
            className={`flex flex-col items-center justify-center px-5 py-2 transition-all ${currentView === 'portfolio' ? 'text-primary' : 'text-on-surface-variant'}`}
          >
            <PieChart size={24} fill={currentView === 'portfolio' ? "currentColor" : "none"} />
            <span className="font-body text-[10px] font-bold uppercase tracking-wider mt-1">Portfolio</span>
          </button>
          <button 
            onClick={() => onViewChange('invest')}
            className={`flex flex-col items-center justify-center px-5 py-2 transition-all ${currentView === 'invest' ? 'text-primary' : 'text-on-surface-variant'}`}
          >
            <Landmark size={24} fill={currentView === 'invest' ? "currentColor" : "none"} />
            <span className="font-body text-[10px] font-bold uppercase tracking-wider mt-1">Invest</span>
          </button>
          <button 
            onClick={() => onViewChange('landing')}
            className={`flex flex-col items-center justify-center px-5 py-2 transition-all ${currentView === 'landing' ? 'text-primary' : 'text-on-surface-variant'}`}
          >
            <BarChart3 size={24} fill={currentView === 'landing' ? "currentColor" : "none"} />
            <span className="font-body text-[10px] font-bold uppercase tracking-wider mt-1">Insights</span>
          </button>
          <button 
            onClick={() => onViewChange('landing')}
            className={`flex flex-col items-center justify-center px-5 py-2 transition-all ${currentView === 'landing' ? 'text-primary' : 'text-on-surface-variant'}`}
          >
            <SettingsIcon size={24} />
            <span className="font-body text-[10px] font-bold uppercase tracking-wider mt-1">Settings</span>
          </button>
        </div>
      </nav>

      {/* Desktop Nav (Optional, but let's keep it simple for now as per images) */}
    </div>
  );
};
