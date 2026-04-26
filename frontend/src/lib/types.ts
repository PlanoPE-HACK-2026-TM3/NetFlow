export interface SearchParams {
  zip_code:       string;
  budget:         number;
  property_type:  "SFH" | "Multi" | "Condo" | "Townhouse";
  min_beds:       number;
  strategy:       "LTR" | "STR" | "BRRRR" | "Flip";
  prompt_text?:   string;
  location?:      string;
  city?:          string;
  state?:         string;
}

export interface Property {
  rank:             number;
  address:          string;
  zip_code:         string;
  price:            number;
  est_rent:         number;
  cap_rate:         number;
  cash_flow:        number;
  grm:              number;
  dom:              number;
  ai_score:         number;
  tags:             string[];
  beds:             number;
  baths:            number;
  sqft:             number;
  year_built?:      number;
  lot_size?:        number;
  mls_id?:          string;
  listing_url?:     string;
  map_query?:       string;
  photo_url?:       string;
  strategy_note?:   string;
  risk_level?:      string;
  llm_correctness?: number;  // 0-100: LLM score vs rule-baseline agreement
}

export interface SearchResult {
  properties:       Property[];
  mortgage_rate:    number;
  market_summary:   string;
  zip_code:         string;
  location_display: string;
  search_params:    SearchParams;
}

export interface ParsedPrompt {
  zip_code:         string;
  location_display: string;
  budget:           number;
  min_beds:         number;
  property_type:    SearchParams["property_type"];
  strategy:         SearchParams["strategy"];
  city:             string;
  state:            string;
  resolved:         boolean;
}
