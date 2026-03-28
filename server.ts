import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const properties = [
  {
    id: "1",
    name: "The Meridian Lofts",
    location: "Austin, TX 78701",
    price: 1250000,
    monthlyRent: 6800,
    projectedROI: 9.2,
    minInvest: 25000,
    yield: 9.2,
    image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
    riskProfile: "High Alpha",
    alphaScore: 98,
    investmentThesis: "Located in a high-demand tech corridor with 12% year-over-year appreciation. Recent rezoning allows for short-term rental optimization, increasing potential cash flow by 30%.",
    assetClass: "Apartment"
  },
  {
    id: "2",
    name: "Heritage Oaks Estate",
    location: "Charleston, SC 29401",
    price: 895000,
    monthlyRent: 4200,
    projectedROI: 7.8,
    minInvest: 10000,
    yield: 7.8,
    image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Exceptional preservation tax credits available. Historic district location ensures supply scarcity and stable long-term value retention for conservative portfolios.",
    assetClass: "Single-Family"
  },
  {
    id: "3",
    name: "The Obsidian Manor",
    location: "Beverly Hills, CA",
    price: 4500000,
    monthlyRent: 22000,
    projectedROI: 7.2,
    minInvest: 125000,
    yield: 7.2,
    image: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Prime Beverly Hills real estate with consistent high-net-worth tenant demand. Minimal vacancy risk and strong historical appreciation.",
    assetClass: "Single-Family"
  },
  {
    id: "4",
    name: "Skyline Loft District",
    location: "Austin, TX",
    price: 750000,
    monthlyRent: 3800,
    projectedROI: 8.5,
    minInvest: 75000,
    yield: 8.5,
    image: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Modern industrial lofts in the heart of Austin's growing tech hub. High walkability score and strong rental demand from young professionals.",
    assetClass: "Condo / Townhouse"
  },
  {
    id: "5",
    name: "Azure Coast Estate",
    location: "Malibu, CA",
    price: 8500000,
    monthlyRent: 45000,
    projectedROI: 6.8,
    minInvest: 250000,
    yield: 6.8,
    image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Exclusive Malibu beachfront property. Rare investment opportunity in a highly restricted development zone with significant long-term capital gains potential.",
    assetClass: "Single-Family"
  },
  {
    id: "6",
    name: "The Metropolitan Tower",
    location: "Chicago, IL",
    price: 1500000,
    monthlyRent: 7500,
    projectedROI: 8.2,
    minInvest: 50000,
    yield: 8.2,
    image: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Newly renovated luxury units in the heart of Chicago's financial district. Strong corporate rental demand and high occupancy rates.",
    assetClass: "Apartment"
  },
  {
    id: "7",
    name: "Emerald Valley Villas",
    location: "Seattle, WA",
    price: 2100000,
    monthlyRent: 11000,
    projectedROI: 8.9,
    minInvest: 100000,
    yield: 8.9,
    image: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80",
    riskProfile: "High Alpha",
    investmentThesis: "Modern eco-friendly villas in a rapidly developing tech suburb. High appreciation potential and premium rental yields.",
    assetClass: "Condo / Townhouse"
  },
  {
    id: "8",
    name: "Riverfront Multi-Family",
    location: "Portland, OR",
    price: 3200000,
    monthlyRent: 18000,
    projectedROI: 9.5,
    minInvest: 150000,
    yield: 9.5,
    image: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Stabilized multi-family asset in a high-growth riverfront district. Consistent cash flow and professional management in place.",
    assetClass: "Multi-Family"
  },
  {
    id: "9",
    name: "Tech Hub Short-Term",
    location: "San Francisco, CA",
    price: 1800000,
    monthlyRent: 12000,
    projectedROI: 11.2,
    minInvest: 50000,
    yield: 11.2,
    image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80",
    riskProfile: "High Alpha",
    investmentThesis: "Optimized for short-term rentals in a high-demand tech area. Significant upside potential through active management and dynamic pricing.",
    assetClass: "Short-Term Rental"
  },
  {
    id: "10",
    name: "Downtown Commercial Plaza",
    location: "Denver, CO",
    price: 5500000,
    monthlyRent: 35000,
    projectedROI: 8.0,
    minInvest: 250000,
    yield: 8.0,
    image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Prime commercial space with long-term anchor tenants. Stable income stream and potential for future redevelopment.",
    assetClass: "Commercial"
  },
  {
    id: "11",
    name: "Sunset Valley Land",
    location: "Phoenix, AZ",
    price: 450000,
    monthlyRent: 0,
    projectedROI: 15.0,
    minInvest: 25000,
    yield: 15.0,
    image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80",
    riskProfile: "High Alpha",
    investmentThesis: "Strategic land acquisition in a path-of-progress area. High appreciation potential as surrounding infrastructure develops.",
    assetClass: "Land"
  },
  {
    id: "12",
    name: "Quiet Suburb Single-Family",
    location: "Nashville, TN",
    price: 550000,
    monthlyRent: 2800,
    projectedROI: 6.5,
    minInvest: 15000,
    yield: 6.5,
    image: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Conservative investment in a stable suburban neighborhood. Low maintenance costs and reliable long-term tenants.",
    assetClass: "Single-Family"
  },
  {
    id: "13",
    name: "Riverside Multi-Family Duplex",
    location: "Savannah, GA",
    price: 920000,
    monthlyRent: 5200,
    projectedROI: 8.4,
    minInvest: 45000,
    yield: 8.4,
    image: "https://images.unsplash.com/photo-1592595896551-12b371d546d5?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Well-maintained duplex in a historic district with high rental demand. Steady cash flow and low vacancy rates.",
    assetClass: "Multi-Family"
  },
  {
    id: "14",
    name: "Urban Edge Apartments",
    location: "Columbus, OH",
    price: 850000,
    monthlyRent: 4800,
    projectedROI: 7.9,
    minInvest: 30000,
    yield: 7.9,
    image: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Modern apartment units in a growing urban neighborhood. Strong demand from young professionals and students.",
    assetClass: "Apartment"
  },
  {
    id: "15",
    name: "Mountain View Short-Term",
    location: "Asheville, NC",
    price: 980000,
    monthlyRent: 7500,
    projectedROI: 10.5,
    minInvest: 40000,
    yield: 10.5,
    image: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=800&q=80",
    riskProfile: "High Alpha",
    investmentThesis: "Premium short-term rental property in a top tourist destination. High seasonal yields and strong appreciation potential.",
    assetClass: "Short-Term Rental"
  },
  {
    id: "16",
    name: "Suburban Retail Strip",
    location: "Indianapolis, IN",
    price: 950000,
    monthlyRent: 6200,
    projectedROI: 8.2,
    minInvest: 100000,
    yield: 8.2,
    image: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Fully leased retail space in a high-traffic suburban area. Long-term leases with established local businesses.",
    assetClass: "Commercial"
  },
  {
    id: "17",
    name: "Prairie Horizon Land",
    location: "Des Moines, IA",
    price: 720000,
    monthlyRent: 0,
    projectedROI: 12.0,
    minInvest: 50000,
    yield: 12.0,
    image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Strategic land parcel in a developing industrial corridor. Significant upside as local development expands.",
    assetClass: "Land"
  },
  {
    id: "18",
    name: "Lakeside Multi-Family",
    location: "Madison, WI",
    price: 880000,
    monthlyRent: 5800,
    projectedROI: 9.1,
    minInvest: 60000,
    yield: 9.1,
    image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
    riskProfile: "High Alpha",
    investmentThesis: "Value-add multi-family opportunity in a desirable lakeside community. Potential to increase rents through minor renovations.",
    assetClass: "Multi-Family"
  },
  {
    id: "19",
    name: "City Center Studio Lofts",
    location: "Salt Lake City, UT",
    price: 650000,
    monthlyRent: 3200,
    projectedROI: 7.5,
    minInvest: 25000,
    yield: 7.5,
    image: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Efficient studio lofts in a high-demand downtown area. Low vacancy and strong rental growth in a tech-heavy market.",
    assetClass: "Apartment"
  },
  {
    id: "20",
    name: "Coastal Breeze STR",
    location: "Galveston, TX",
    price: 790000,
    monthlyRent: 6000,
    projectedROI: 9.8,
    minInvest: 35000,
    yield: 9.8,
    image: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Charming coastal property optimized for vacation rentals. High demand during peak seasons and strong historical performance.",
    assetClass: "Short-Term Rental"
  },
  {
    id: "21",
    name: "Beverly Hills Multi-Family",
    location: "Beverly Hills, CA 90210",
    price: 4200000,
    monthlyRent: 25000,
    projectedROI: 7.5,
    minInvest: 200000,
    yield: 7.5,
    image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Low Risk",
    investmentThesis: "Stable multi-family asset in a prime 90210 location. High-end tenants and minimal vacancy risk.",
    assetClass: "Multi-Family"
  },
  {
    id: "22",
    name: "Modern Loft 90210",
    location: "Beverly Hills, CA 90210",
    price: 1200000,
    monthlyRent: 6500,
    projectedROI: 8.1,
    minInvest: 50000,
    yield: 8.1,
    image: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80",
    riskProfile: "Medium",
    investmentThesis: "Contemporary loft in a prestigious zip code. Strong rental demand from professionals and high appreciation potential.",
    assetClass: "Apartment"
  }
];

const portfolio = {
  totalInvestment: 4280000,
  monthlyIncome: 18450,
  savedFavorites: ["3", "4", "5"]
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/properties", (req, res) => {
    res.json(properties);
  });

  app.post("/api/properties/search", (req, res) => {
    const filters = req.body;
    let filtered = [...properties];

    if (filters.assetClasses && filters.assetClasses.length > 0) {
      filtered = filtered.filter(p => filters.assetClasses.includes(p.assetClass));
    }

    if (filters.priceRange) {
      filtered = filtered.filter(p => p.price >= filters.priceRange[0] && p.price <= filters.priceRange[1]);
    }

    if (filters.riskProfile && filters.riskProfile !== 'All') {
      filtered = filtered.filter(p => p.riskProfile === filters.riskProfile);
    }

    if (filters.roiRange) {
      filtered = filtered.filter(p => p.projectedROI >= filters.roiRange[0] && p.projectedROI <= filters.roiRange[1]);
    }

    if (filters.zipCode) {
      filtered = filtered.filter(p => p.location.includes(filters.zipCode));
    }

    res.json(filtered);
  });

  app.get("/api/portfolio", (req, res) => {
    res.json(portfolio);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
