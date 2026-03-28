import React, { useEffect, useState } from 'react';
import { Property, FilterState, RiskProfile } from '../types';
import { searchProperties } from '../services/api';
import { PropertyCard } from '../components/PropertyCard';
import { Filter, X, ChevronDown, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as Slider from '@radix-ui/react-slider';

interface InvestViewProps {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  showFavoritesOnly?: boolean;
}

export const InvestView: React.FC<InvestViewProps> = ({ 
  filters, 
  setFilters, 
  favorites, 
  onToggleFavorite,
  showFavoritesOnly = false
}) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'best' | 'roi' | 'price-low' | 'price-high'>('best');
  const [showSortOptions, setShowSortOptions] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);

  useEffect(() => {
    const fetchFiltered = async () => {
      setIsLoading(true);
      try {
        const results = await searchProperties(filters);
        setProperties(results);
      } catch (error) {
        console.error("Failed to fetch filtered properties:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFiltered();
    setVisibleCount(5); // Reset visible count when filters change
  }, [filters]);

  const filteredProperties = showFavoritesOnly 
    ? properties.filter(p => favorites.includes(p.id))
    : properties;

  const sortedProperties = [...filteredProperties].sort((a, b) => {
    switch (sortBy) {
      case 'roi':
        return b.projectedROI - a.projectedROI;
      case 'price-low':
        return a.price - b.price;
      case 'price-high':
        return b.price - a.price;
      default:
        return 0; // 'best' overall (mocked as default order)
    }
  });

  const sortLabels = {
    'best': 'Best overall',
    'roi': 'Highest ROI',
    'price-low': 'Price: Low to High',
    'price-high': 'Price: High to Low'
  };

  const assetClasses = [
    "Single-Family", "Multi-Family", "Condo / Townhouse", 
    "Apartment", "Short-Term Rental", "Commercial", "Land"
  ];

  const handleAssetClassToggle = (ac: string) => {
    setFilters(prev => ({
      ...prev,
      assetClasses: prev.assetClasses.includes(ac) 
        ? prev.assetClasses.filter(item => item !== ac)
        : [...prev.assetClasses, ac]
    }));
  };

  const handleRiskProfileChange = (risk: RiskProfile | 'All') => {
    setFilters(prev => ({ ...prev, riskProfile: risk }));
  };

  const handlePriceRangeChange = (values: number[]) => {
    setFilters(prev => ({ ...prev, priceRange: [values[0], values[1]] }));
  };

  const handleRoiRangeChange = (values: number[]) => {
    setFilters(prev => ({ ...prev, roiRange: [values[0], values[1]] }));
  };

  const clearFilters = () => {
    setFilters({
      capital: 500000,
      minAllocation: 25000,
      maxAllocation: 150000,
      zipCode: '',
      assetClasses: ['Multi-Family', 'Apartment', 'Single-Family'],
      priceRange: [100000, 5000000],
      roiRange: [5, 15],
      riskProfile: 'Low Risk'
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6">
      {/* Market Data Delay Alert */}
      <div className="mb-8 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl flex items-start gap-4 relative">
        <div className="text-red-500 shrink-0 mt-1">
          <AlertCircle size={24} />
        </div>
        <div className="flex-1">
          <h4 className="font-headline font-bold text-red-900">Market Data Delay</h4>
          <p className="text-sm text-red-800 leading-relaxed">
            Real-time yields for San Francisco properties are currently being updated. Displayed values may be delayed by 15 minutes.
          </p>
        </div>
        <button className="text-red-500 hover:text-red-700">
          <X size={18} />
        </button>
      </div>

      {/* New Filter Section */}
      <section className="mb-12 bg-surface-container-low p-8 rounded-2xl border border-outline-variant/10 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h3 className="font-headline text-2xl font-bold text-primary">Refine Results</h3>
          <button onClick={clearFilters} className="text-secondary text-sm font-bold uppercase tracking-wider hover:underline">Clear All</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* Property Type */}
          <div className="space-y-4">
            <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Property Type</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {assetClasses.map(ac => (
                <label key={ac} className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={filters.assetClasses.includes(ac)}
                    onChange={() => handleAssetClassToggle(ac)}
                    className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary" 
                  />
                  <span className={`text-xs font-medium transition-colors ${filters.assetClasses.includes(ac) ? 'text-primary' : 'text-on-surface-variant group-hover:text-primary'}`}>{ac}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Price Range */}
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Price Range</p>
              <span className="text-[10px] font-bold text-primary">${(filters.priceRange[0]/1000).toFixed(0)}k - ${(filters.priceRange[1]/1000).toFixed(0)}k</span>
            </div>
            <Slider.Root
              className="relative flex items-center select-none touch-none w-full h-5"
              value={filters.priceRange}
              onValueChange={handlePriceRangeChange}
              max={5000000}
              min={50000}
              step={50000}
              minStepsBetweenThumbs={1}
            >
              <Slider.Track className="bg-surface-container-high relative grow rounded-full h-[4px]">
                <Slider.Range className="absolute bg-primary rounded-full h-full" />
              </Slider.Track>
              <Slider.Thumb
                className="block w-4 h-4 bg-white shadow-sm border-2 border-primary rounded-full hover:scale-110 focus:outline-none transition-transform cursor-pointer"
                aria-label="Min price"
              />
              <Slider.Thumb
                className="block w-4 h-4 bg-white shadow-sm border-2 border-primary rounded-full hover:scale-110 focus:outline-none transition-transform cursor-pointer"
                aria-label="Max price"
              />
            </Slider.Root>
            <div className="flex justify-between text-[10px] font-bold text-on-surface-variant">
              <span>$50k</span>
              <span>$5M+</span>
            </div>
          </div>

          {/* Risk Profile */}
          <div className="space-y-4">
            <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Risk Profile</p>
            <div className="flex flex-wrap gap-2">
              {(['Low Risk', 'Medium', 'High Alpha'] as RiskProfile[]).map(risk => (
                <button 
                  key={risk} 
                  onClick={() => handleRiskProfileChange(risk)}
                  className={`px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${filters.riskProfile === risk ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`}
                >
                  {risk}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Results List */}
        <div className="flex-1 space-y-8">
          <div className="space-y-2">
            <h2 className="font-headline text-4xl font-extrabold text-primary tracking-tight">
              {showFavoritesOnly ? 'Saved Investments' : 'Top Yield Opportunities'}
            </h2>
            <p className="text-on-surface-variant font-medium">
              {isLoading ? 'Searching...' : `Found ${sortedProperties.length} institutional-grade properties matching your criteria.`}
            </p>
          </div>

          <div className="flex items-center gap-4 py-4 border-b border-outline-variant/10 relative">
            <span className="text-sm font-bold text-on-surface-variant">Sort by:</span>
            <div className="relative">
              <button 
                onClick={() => setShowSortOptions(!showSortOptions)}
                className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-lg text-sm font-bold text-primary border border-outline-variant/10 hover:bg-surface-container-high transition-colors"
              >
                {sortLabels[sortBy]} <ChevronDown size={16} className={`transition-transform ${showSortOptions ? 'rotate-180' : ''}`} />
              </button>
              
              <AnimatePresence>
                {showSortOptions && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-outline-variant/10 z-50 overflow-hidden"
                  >
                    {Object.entries(sortLabels).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => {
                          setSortBy(key as any);
                          setShowSortOptions(false);
                        }}
                        className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors hover:bg-surface-container-low ${sortBy === key ? 'text-primary bg-surface-container-low' : 'text-on-surface-variant'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="space-y-8 min-h-[400px]">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
                <p className="text-on-surface-variant font-medium">Fetching the best opportunities...</p>
              </div>
            ) : sortedProperties.length > 0 ? (
              sortedProperties.slice(0, visibleCount).map(property => (
                <PropertyCard 
                  key={property.id} 
                  property={property} 
                  isFavorite={favorites.includes(property.id)}
                  onToggleFavorite={onToggleFavorite}
                />
              ))
            ) : (
              <div className="bg-surface-container-low rounded-2xl p-12 text-center space-y-4 border border-outline-variant/10">
                <div className="bg-surface-container-high w-16 h-16 rounded-full flex items-center justify-center mx-auto text-on-surface-variant">
                  <Filter size={32} />
                </div>
                <h3 className="font-headline text-2xl font-bold text-primary">No Properties Found</h3>
                <p className="text-on-surface-variant max-w-md mx-auto">
                  We couldn't find any properties matching your current filters. Try adjusting your price range or risk profile to see more results.
                </p>
                <button 
                  onClick={clearFilters}
                  className="text-primary font-bold hover:underline"
                >
                  Reset all filters
                </button>
              </div>
            )}
          </div>

          {sortedProperties.length > visibleCount && (
            <div className="pt-8 pb-12 text-center">
              <button 
                onClick={() => setVisibleCount(prev => prev + 5)}
                className="bg-surface-container-high text-primary font-headline font-bold py-4 px-12 rounded-xl hover:bg-surface-container-highest transition-colors active:scale-95"
              >
                Load More Opportunities
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Filter Button */}
      <button 
        onClick={() => setShowFilters(true)}
        className="lg:hidden fixed bottom-28 left-1/2 -translate-x-1/2 signature-gradient text-white px-8 py-4 rounded-full font-headline font-bold shadow-2xl flex items-center gap-3 z-40"
      >
        <Filter size={20} />
        Filters (3)
      </button>

      {/* Mobile Filter Drawer */}
      <AnimatePresence>
        {showFilters && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFilters(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="fixed bottom-0 left-0 w-full bg-white rounded-t-3xl p-8 z-[70] max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="font-headline text-2xl font-bold text-primary">Filters</h3>
                <button onClick={() => setShowFilters(false)} className="p-2 bg-surface-container-low rounded-full">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-8">
                <div className="space-y-4">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Property Type</p>
                  <div className="grid grid-cols-2 gap-3">
                    {assetClasses.map(ac => (
                      <label key={ac} className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={filters.assetClasses.includes(ac)}
                          onChange={() => handleAssetClassToggle(ac)}
                          className="w-5 h-5 rounded border-outline-variant text-primary" 
                        />
                        <span className="text-sm font-medium text-on-surface-variant">{ac}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button 
                  onClick={() => setShowFilters(false)}
                  className="w-full signature-gradient text-white py-5 rounded-xl font-headline font-bold text-lg"
                >
                  Apply Filters
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
