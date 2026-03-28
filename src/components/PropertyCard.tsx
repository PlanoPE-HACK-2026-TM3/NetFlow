import React from 'react';
import { Property } from '../types';
import { Heart, MapPin, TrendingUp, Info } from 'lucide-react';
import { motion } from 'motion/react';

interface PropertyCardProps {
  property: Property;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  variant?: 'compact' | 'full';
}

export const PropertyCard: React.FC<PropertyCardProps> = ({ 
  property, 
  isFavorite = false, 
  onToggleFavorite,
  variant = 'full' 
}) => {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

  if (variant === 'compact') {
    return (
      <motion.div 
        whileHover={{ y: -4 }}
        className="group bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10 shadow-sm"
      >
        <div className="aspect-video relative overflow-hidden">
          <img 
            src={property.image} 
            alt={property.name} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.(property.id);
            }}
            className={`absolute top-3 right-3 p-2 rounded-full shadow-sm transition-colors ${isFavorite ? 'bg-red-500 text-white' : 'bg-white/90 backdrop-blur text-red-500'}`}
          >
            <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <h4 className="font-headline text-lg font-bold text-primary">{property.name}</h4>
            <p className="text-xs text-on-surface-variant">{property.location}</p>
          </div>
          <div className="flex justify-between items-end pt-2 border-t border-outline-variant/10">
            <div>
              <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Est. Yield</p>
              <p className="font-headline font-bold text-on-tertiary-container">{property.yield}% APR</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">Minimum</p>
              <p className="font-headline font-bold text-primary">{formatCurrency(property.minInvest)}</p>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10 shadow-md mb-8"
    >
      <div className="relative aspect-[16/9]">
        <img 
          src={property.image} 
          alt={property.name} 
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        {property.alphaScore && (
          <div className="absolute top-4 left-4 bg-primary text-white px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider">
            High Alpha Score: {property.alphaScore}
          </div>
        )}
        <button 
          onClick={() => onToggleFavorite?.(property.id)}
          className={`absolute top-4 right-4 backdrop-blur-md p-2 rounded-full transition-all ${isFavorite ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-white/20 text-white hover:bg-white/40'}`}
        >
          <Heart size={20} fill={isFavorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h3 className="font-headline text-2xl font-extrabold text-primary">{property.name}</h3>
            <div className="flex items-center gap-1 text-on-surface-variant">
              <MapPin size={14} />
              <span className="text-sm font-medium">{property.location}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="font-headline text-3xl font-bold text-on-tertiary-container leading-none">{property.projectedROI}%</p>
            <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant mt-1">Projected ROI</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 py-4 border-y border-outline-variant/10">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">Price</p>
            <p className="font-headline font-bold text-primary">{formatCurrency(property.price)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">Monthly Rent</p>
            <p className="font-headline font-bold text-primary">{formatCurrency(property.monthlyRent)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">Min. Invest</p>
            <p className="font-headline font-bold text-primary">{formatCurrency(property.minInvest)}</p>
          </div>
        </div>

        <div className="bg-surface-container-low rounded-xl p-5 flex gap-4">
          <div className="text-secondary shrink-0">
            <TrendingUp size={20} />
          </div>
          <div className="space-y-2">
            <p className="text-[10px] uppercase font-bold tracking-widest text-secondary">Why this is a good investment</p>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {property.investmentThesis}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="px-4 py-1.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold uppercase tracking-wider">
            {property.riskProfile} Profile
          </span>
          <button className="signature-gradient text-white px-8 py-3 rounded-lg font-headline font-bold text-sm shadow-lg shadow-primary/20 active:scale-95 transition-all">
            Invest Now
          </button>
        </div>
      </div>
    </motion.div>
  );
};
