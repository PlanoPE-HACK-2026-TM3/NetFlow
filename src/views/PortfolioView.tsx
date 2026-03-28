import React, { useEffect, useState } from 'react';
import { Portfolio, Property } from '../types';
import { fetchPortfolio, fetchProperties } from '../services/api';
import { PropertyCard } from '../components/PropertyCard';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

interface PortfolioViewProps {
  onFindInvestments: () => void;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({ onFindInvestments, favorites, onToggleFavorite }) => {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);

  useEffect(() => {
    Promise.all([fetchPortfolio(), fetchProperties()]).then(([port, props]) => {
      setPortfolio(port);
      setProperties(props);
    });
  }, []);

  if (!portfolio) return <div className="p-8 text-center">Loading portfolio...</div>;

  const savedFavorites = properties.filter(p => favorites.includes(p.id));

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 space-y-8">
      <section className="space-y-6">
        <h2 className="font-headline text-4xl font-extrabold text-primary tracking-tight">Portfolio</h2>
        
        <div className="bg-surface-container-low rounded-xl p-8 space-y-6 border border-outline-variant/10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <p className="font-label text-xs uppercase tracking-widest text-on-surface-variant mb-1">Total Investment</p>
              <p className="font-headline text-4xl font-bold text-primary">
                ${portfolio.totalInvestment.toLocaleString()}
              </p>
            </div>
            <div className="hidden md:block h-12 w-px bg-outline-variant/30"></div>
            <div>
              <p className="font-label text-xs uppercase tracking-widest text-on-surface-variant mb-1">Monthly Income</p>
              <p className="font-headline text-4xl font-bold text-on-tertiary-container">
                +${portfolio.monthlyIncome.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="hidden md:block aspect-[21/9] rounded-xl overflow-hidden shadow-xl">
          <img 
            alt="Modern luxury architecture" 
            className="w-full h-full object-cover" 
            src="https://images.unsplash.com/photo-1600607687940-467f5b63c764?auto=format&fit=crop&w=1200&q=80"
            referrerPolicy="no-referrer"
          />
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/20">
        <div className="flex flex-col md:flex-row gap-8 items-end">
          <div className="flex-1 w-full">
            <label className="font-label text-xs uppercase font-semibold text-on-surface-variant mb-4 block">Amount to Invest</label>
            <div className="relative flex items-center border-b-2 border-outline-variant focus-within:border-primary transition-colors">
              <span className="text-4xl font-headline font-bold text-primary mr-2">$</span>
              <input 
                type="text" 
                defaultValue="500,000"
                className="w-full bg-transparent border-none focus:ring-0 font-headline text-5xl font-bold text-primary pb-2"
              />
            </div>
          </div>
          <button 
            onClick={onFindInvestments}
            className="signature-gradient text-white font-headline font-bold py-5 px-10 rounded-xl w-full md:w-auto active:scale-[0.98] transition-all duration-200 shadow-lg shadow-primary/20"
          >
            Find Investment
          </button>
        </div>
      </section>

      <section className="space-y-6 pb-12">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-headline text-2xl font-bold text-primary">Saved Favorites</h3>
          <button className="text-secondary text-sm font-bold hover:bg-surface-container-high px-4 py-2 rounded-lg transition-colors">View All</button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {savedFavorites.map(property => (
            <PropertyCard 
              key={property.id} 
              property={property} 
              isFavorite 
              onToggleFavorite={onToggleFavorite}
              variant="compact" 
            />
          ))}
        </div>
      </section>
    </div>
  );
};
