from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PropertySearchRequest(BaseModel):
    location: str = Field(min_length=2, max_length=120)
    limit: int = Field(default=50, ge=1, le=200)
    allow_demo: bool = False


class PropertyOut(BaseModel):
    property_id: str
    address: str
    city: str
    state: str
    zip: str | None = None
    price: float
    beds: float | None = None
    baths: float | None = None
    sqft: int | None = None
    listing_url: str | None = None
    description: str | None = None
    source: str = "homeharvest"


class AnalysisRequest(BaseModel):
    property: PropertyOut


class AnalysisOut(BaseModel):
    property_id: str
    investment_score: int
    risk_score: int
    confidence: float
    projected_12m_change_percent: float
    recommendation: str
    rationale: str


class MortgageRateOut(BaseModel):
    series: str
    value: float
    date: str


class NewsItem(BaseModel):
    title: str
    source: str
    url: str
    published_at: str


class NewsResponse(BaseModel):
    headlines: list[NewsItem]


class PortfolioCreate(BaseModel):
    property_id: str
    address: str
    city: str
    state: str
    price: float
    notes: str = ""


class PortfolioItemOut(PortfolioCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class ChatResponse(BaseModel):
    answer: str


class PredictionFeedbackIn(BaseModel):
    property_id: str
    predicted_12m_change_percent: float
    actual_12m_change_percent: float
    confidence: float = Field(ge=0, le=1)
    recommendation: str


class PredictionFeedbackOut(PredictionFeedbackIn):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    model_name: str
    created_at: datetime


class ModelPerformanceOut(BaseModel):
    feedback_count: int
    mae: float | None = None
    rmse: float | None = None
    directional_accuracy: float | None = None
    avg_error: float | None = None
    calibration_shift: float = 0.0


class InferenceEventOut(BaseModel):
    id: int
    operation: str
    success: bool
    latency_ms: float
    fallback_used: bool
    provider: str
    input_summary: str
    output_summary: str
    created_at: datetime

    class Config:
        from_attributes = True


class TracingVerifyOut(BaseModel):
    langsmith_enabled: bool
    langsmith_api_key_set: bool
    langsmith_project: str
    langsmith_endpoint: str
    langchain_tracing_v2: str | None = None
    ollama_reachable: bool
    ollama_model_configured: str
    ollama_model_seen_in_tags: bool = False
    langchain_invoke_ok: bool
    invoke_error: str | None = None
