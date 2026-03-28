import { Property, Portfolio, FilterState } from '../types';

export async function fetchProperties(): Promise<Property[]> {
  const response = await fetch('/api/properties');
  if (!response.ok) throw new Error('Failed to fetch properties');
  return response.json();
}

export async function searchProperties(filters: FilterState): Promise<Property[]> {
  const response = await fetch('/api/properties/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(filters),
  });
  if (!response.ok) throw new Error('Failed to search properties');
  return response.json();
}

export async function fetchPortfolio(): Promise<Portfolio> {
  const response = await fetch('/api/portfolio');
  if (!response.ok) throw new Error('Failed to fetch portfolio');
  return response.json();
}
