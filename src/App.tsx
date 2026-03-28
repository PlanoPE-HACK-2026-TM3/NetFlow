/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { View, FilterState } from './types';
import { Layout } from './components/Layout';
import { PortfolioView } from './views/PortfolioView';
import { InvestView } from './views/InvestView';
import { LandingView } from './views/LandingView';
import { motion, AnimatePresence } from 'motion/react';

const initialFilters: FilterState = {
  capital: 500000,
  minAllocation: 25000,
  maxAllocation: 150000,
  zipCode: '',
  assetClasses: ['Multi-Family', 'Apartment', 'Single-Family'],
  priceRange: [100000, 5000000],
  roiRange: [5, 15],
  riskProfile: 'Low Risk'
};

export default function App() {
  const [currentView, setCurrentView] = useState<View>('landing');
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('netflow_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('netflow_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (propertyId: string) => {
    setFavorites(prev => 
      prev.includes(propertyId) 
        ? prev.filter(id => id !== propertyId) 
        : [...prev, propertyId]
    );
  };

  const renderView = () => {
    switch (currentView) {
      case 'portfolio':
        return <PortfolioView key="portfolio" favorites={favorites} onToggleFavorite={toggleFavorite} onFindInvestments={() => setCurrentView('invest')} />;
      case 'invest':
        return <InvestView key="invest" filters={filters} setFilters={setFilters} favorites={favorites} onToggleFavorite={toggleFavorite} showFavoritesOnly={showFavoritesOnly} />;
      case 'landing':
        return <LandingView key="landing" filters={filters} setFilters={setFilters} onFindInvestments={() => setCurrentView('invest')} />;
      default:
        return <LandingView filters={filters} setFilters={setFilters} onFindInvestments={() => setCurrentView('invest')} />;
    }
  };

  return (
    <Layout 
      currentView={currentView} 
      onViewChange={setCurrentView}
      showFavoritesOnly={showFavoritesOnly}
      onToggleFavoritesOnly={() => {
        setShowFavoritesOnly(!showFavoritesOnly);
        if (currentView !== 'invest') setCurrentView('invest');
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {renderView()}
        </motion.div>
      </AnimatePresence>
    </Layout>
  );
}
