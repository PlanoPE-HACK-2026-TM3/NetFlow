import React from 'react';
import { ArrowRight, DollarSign, Settings2, MapPin, Building2, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { FilterState, RiskProfile } from '../types';
import * as Slider from '@radix-ui/react-slider';

interface LandingViewProps {
  onFindInvestments: () => void;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
}

export const LandingView: React.FC<LandingViewProps> = ({ onFindInvestments, filters, setFilters }) => {
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

  const handleAllocationChange = (values: number[]) => {
    setFilters(prev => ({
      ...prev,
      minAllocation: values[0],
      maxAllocation: values[1]
    }));
  };

  return (
    <div className="max-w-7xl mx-auto px-6 pt-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left Column: Editorial Content */}
        <div className="lg:col-span-5 space-y-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            <p className="font-label text-sm uppercase tracking-[0.2em] text-on-surface-variant font-bold">Insight into income</p>
            <h2 className="font-headline text-6xl font-extrabold tracking-tight text-primary leading-[1.1]">
              Turn Capital<br/>
              <span className="text-secondary">Into Cash Flow</span>
            </h2>
            <p className="text-xl text-on-surface-variant max-w-md leading-relaxed">
              From budget to properties, we map your path to returns. Set your budget, risk, and goals—NetFlow reveals the best opportunities.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="hidden lg:block relative h-80 rounded-2xl overflow-hidden shadow-2xl"
          >
            <img 
              alt="Modern architecture" 
              className="w-full h-full object-cover" 
              src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/60 to-transparent"></div>
          </motion.div>
        </div>

        {/* Right Column: Input Controls */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-7"
        >
          <div className="bg-surface-container-low rounded-3xl p-8 lg:p-12 border border-outline-variant/10 shadow-sm">
            <div className="space-y-12">
              {/* Investment Amount */}
              <div className="space-y-4">
                <label className="font-headline text-xl font-bold text-primary flex items-center gap-3">
                  <DollarSign className="text-secondary" size={24} />
                  Total Investment Capital
                </label>
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-3xl font-bold text-on-surface-variant">$</span>
                  <input 
                    className="w-full bg-surface-container-highest border-none focus:ring-2 focus:ring-primary rounded-2xl py-8 pl-14 pr-8 text-3xl font-headline font-bold text-primary transition-all" 
                    placeholder="500,000" 
                    type="number"
                    value={filters.capital}
                    onChange={(e) => setFilters(prev => ({ ...prev, capital: Number(e.target.value) }))}
                  />
                </div>
                <p className="font-label text-xs text-on-surface-variant/80 italic">Enter the total amount you wish to allocate across your portfolio.</p>
              </div>

              {/* Range Slider: Allocation */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label className="font-headline text-xl font-bold text-primary flex items-center gap-3">
                    <Settings2 className="text-secondary" size={24} />
                    Allocation Per Asset
                  </label>
                  <div className="flex gap-6 text-right">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Min</p>
                      <p className="font-headline font-bold text-secondary text-lg">${(filters.minAllocation / 1000).toFixed(0)}k</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Max</p>
                      <p className="font-headline font-bold text-secondary text-lg">${(filters.maxAllocation / 1000).toFixed(0)}k</p>
                    </div>
                  </div>
                </div>
                <div className="relative py-6">
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-5"
                    value={[filters.minAllocation, filters.maxAllocation]}
                    onValueChange={handleAllocationChange}
                    max={500000}
                    min={10000}
                    step={5000}
                    minStepsBetweenThumbs={1}
                  >
                    <Slider.Track className="bg-surface-container-highest relative grow rounded-full h-[6px]">
                      <Slider.Range className="absolute bg-secondary rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb
                      className="block w-6 h-6 bg-white shadow-xl border-2 border-secondary rounded-full hover:scale-110 focus:outline-none transition-transform cursor-pointer"
                      aria-label="Minimum allocation"
                    />
                    <Slider.Thumb
                      className="block w-6 h-6 bg-white shadow-xl border-2 border-secondary rounded-full hover:scale-110 focus:outline-none transition-transform cursor-pointer"
                      aria-label="Maximum allocation"
                    />
                  </Slider.Root>
                  <p className="font-label text-[10px] text-on-surface-variant/60 mt-4 uppercase tracking-widest">Slide handles to adjust minimum and maximum allocation per asset</p>
                </div>
              </div>

              {/* Price Range & Risk Profile */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <label className="font-headline text-xl font-bold text-primary flex items-center gap-3">
                    <ShieldCheck className="text-secondary" size={24} />
                    Risk Profile
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(['All', 'Low Risk', 'Medium', 'High Alpha'] as (RiskProfile | 'All')[]).map(risk => (
                      <button 
                        key={risk} 
                        onClick={() => handleRiskProfileChange(risk)}
                        className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${filters.riskProfile === risk ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`}
                      >
                        {risk}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="font-headline text-xl font-bold text-primary flex items-center gap-3">
                    <MapPin className="text-secondary" size={24} />
                    Target Zip Code
                  </label>
                  <input 
                    className="w-full bg-surface-container-highest border-none focus:ring-2 focus:ring-primary rounded-2xl py-5 px-8 text-xl font-body font-bold text-primary transition-all" 
                    maxLength={5} 
                    placeholder="90210" 
                    type="text"
                    value={filters.zipCode}
                    onChange={(e) => setFilters(prev => ({ ...prev, zipCode: e.target.value }))}
                  />
                </div>
              </div>

              {/* Asset Class Selection */}
              <div className="space-y-4">
                <label className="font-headline text-xl font-bold text-primary flex items-center gap-3">
                  <Building2 className="text-secondary" size={24} />
                  Asset Class
                </label>
                <div className="flex flex-wrap gap-3">
                  {assetClasses.map(ac => (
                    <span 
                      key={ac} 
                      onClick={() => handleAssetClassToggle(ac)}
                      className={`px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-all border-2 ${filters.assetClasses.includes(ac) ? 'bg-primary text-white border-primary' : 'bg-transparent text-on-surface-variant border-outline-variant/20 hover:border-primary/40'}`}
                    >
                      {ac}
                    </span>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <div className="pt-8">
                <button 
                  onClick={onFindInvestments}
                  className="w-full signature-gradient text-white py-6 rounded-2xl font-headline font-bold text-xl tracking-wide hover:opacity-95 transition-all flex items-center justify-center gap-4 group shadow-2xl shadow-primary/30 active:scale-[0.99]"
                >
                  Find Investments
                  <ArrowRight className="group-hover:translate-x-2 transition-transform" size={24} />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
