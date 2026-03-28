export type RiskProfile = 'Low Risk' | 'Medium' | 'High Alpha';

export interface Property {
  id: string;
  name: string;
  location: string;
  price: number;
  monthlyRent: number;
  projectedROI: number;
  minInvest: number;
  yield: number;
  image: string;
  riskProfile: RiskProfile;
  alphaScore?: number;
  investmentThesis: string;
  assetClass: string;
}

export interface Portfolio {
  totalInvestment: number;
  monthlyIncome: number;
  savedFavorites: string[];
}

export interface FilterState {
  capital: number;
  minAllocation: number;
  maxAllocation: number;
  zipCode: string;
  assetClasses: string[];
  priceRange: [number, number];
  roiRange: [number, number];
  riskProfile: RiskProfile | 'All';
}

export type View = 'portfolio' | 'invest' | 'landing';
