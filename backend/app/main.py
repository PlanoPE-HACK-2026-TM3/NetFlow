import time

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.config import settings
from app.models import InferenceEvent, PortfolioItem
from app.schemas import (
    AnalysisRequest,
    AnalysisOut,
    ChatRequest,
    ChatResponse,
    InferenceEventOut,
    ModelPerformanceOut,
    MortgageRateOut,
    NewsResponse,
    PortfolioCreate,
    PortfolioItemOut,
    PredictionFeedbackIn,
    PredictionFeedbackOut,
    PropertyOut,
    PropertySearchRequest,
    TracingVerifyOut,
)
from app.services.analysis import analyze_property
from app.services.chat import build_chat_response
from app.services.fred import get_mortgage_rate
from app.services.news import get_housing_news
from app.services.observability import add_prediction_feedback, get_calibration_shift, get_model_performance, log_inference_event
from app.services.local_listings import get_local_listings_stats
from app.services.properties import PropertySearchProviderError, search_properties
from app.services.tracing import verify_tracing_runtime

app = FastAPI(title="NETFLOW API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@app.get("/tracing/status")
def tracing_status() -> dict:
    local_stats = get_local_listings_stats()
    return {
        "langsmith_tracing": settings.langsmith_tracing,
        "langsmith_project": settings.langsmith_project,
        "langsmith_endpoint": settings.langsmith_endpoint,
        "langsmith_api_key_set": bool(settings.langsmith_api_key),
        "langsmith_enabled": bool(settings.langsmith_api_key and settings.langsmith_tracing),
        "ollama_base_url": settings.ollama_base_url,
        "ollama_model": settings.ollama_model,
        "local_listings_path": local_stats["path"],
        "local_listings_records": local_stats["records"],
    }


@app.get("/providers/status")
def providers_status() -> dict:
    local_stats = get_local_listings_stats()
    return {
        "local_listings_path": local_stats["path"],
        "local_listings_exists": local_stats["exists"],
        "local_listings_records": local_stats["records"],
        "homeharvest_enabled": True,
        "zip_resolution_enabled": True,
    }


@app.get("/tracing/verify", response_model=TracingVerifyOut)
async def tracing_verify() -> TracingVerifyOut:
    payload = await verify_tracing_runtime()
    return TracingVerifyOut(**payload)


@app.post("/properties/search", response_model=list[PropertyOut])
def properties_search(payload: PropertySearchRequest) -> list[PropertyOut]:
    try:
        return search_properties(location=payload.location, limit=payload.limit, allow_demo=payload.allow_demo)
    except PropertySearchProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/rates/mortgage", response_model=MortgageRateOut)
async def mortgage_rate() -> MortgageRateOut:
    data = await get_mortgage_rate()
    return MortgageRateOut(**data)


@app.get("/news/housing", response_model=NewsResponse)
async def housing_news(limit: int = 5) -> NewsResponse:
    data = await get_housing_news(limit=limit)
    return NewsResponse(**data)


@app.post("/analysis/property", response_model=AnalysisOut)
async def property_analysis(payload: AnalysisRequest, db: Session = Depends(get_db)) -> AnalysisOut:
    started = time.perf_counter()
    rate_data = await get_mortgage_rate()
    news = await get_housing_news(limit=5)
    result = await analyze_property(
        payload.property,
        mortgage_rate=rate_data["value"],
        news_count=len(news["headlines"]),
    )

    # Lightweight "training": calibrate projection with aggregate historical bias.
    calibration_shift = get_calibration_shift(db)
    adjusted_projection = round(
        max(-25.0, min(25.0, result.projected_12m_change_percent + calibration_shift)),
        2,
    )
    if calibration_shift != 0:
        result = result.model_copy(
            update={
                "projected_12m_change_percent": adjusted_projection,
                "rationale": f"{result.rationale} Calibrated by {calibration_shift:+.2f}% from historical feedback.",
            }
        )

    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    fallback_used = "fallback" in result.rationale.lower() or "heuristic" in result.rationale.lower()
    log_inference_event(
        db,
        operation="analysis.property",
        success=True,
        latency_ms=latency_ms,
        fallback_used=fallback_used,
        provider="ollama" if not fallback_used else "heuristic",
        input_summary=f"property_id={payload.property.property_id}; location={payload.property.city},{payload.property.state}",
        output_summary=f"rec={result.recommendation}; invest={result.investment_score}; risk={result.risk_score}",
    )
    return result


@app.get("/portfolio", response_model=list[PortfolioItemOut])
def list_portfolio(db: Session = Depends(get_db)) -> list[PortfolioItemOut]:
    return db.query(PortfolioItem).order_by(PortfolioItem.created_at.desc()).all()


@app.post("/portfolio", response_model=PortfolioItemOut)
def add_portfolio(item: PortfolioCreate, db: Session = Depends(get_db)) -> PortfolioItemOut:
    db_item = PortfolioItem(**item.model_dump())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


@app.delete("/portfolio/{item_id}")
def delete_portfolio(item_id: int, db: Session = Depends(get_db)) -> dict:
    item = db.query(PortfolioItem).filter(PortfolioItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")
    db.delete(item)
    db.commit()
    return {"deleted": item_id}


@app.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    started = time.perf_counter()
    portfolio_items = db.query(PortfolioItem).all()
    portfolio = [PortfolioItemOut.model_validate(p) for p in portfolio_items]

    analyses = []
    rate_data = await get_mortgage_rate()
    for item in portfolio[:5]:
        prop = PropertyOut(
            property_id=item.property_id,
            address=item.address,
            city=item.city,
            state=item.state,
            zip=None,
            price=item.price,
            beds=None,
            baths=None,
            sqft=None,
            listing_url=None,
            description=item.notes,
            source="portfolio",
        )
        analyses.append(await analyze_property(prop, mortgage_rate=rate_data["value"], news_count=3))

    answer = await build_chat_response(payload.message, portfolio, rate_data["value"], analyses)
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    fallback_used = "fallback assistant" in answer.lower()
    log_inference_event(
        db,
        operation="chat.forecast",
        success=True,
        latency_ms=latency_ms,
        fallback_used=fallback_used,
        provider="ollama" if not fallback_used else "rule_based",
        input_summary=f"message_len={len(payload.message)}; portfolio_count={len(portfolio)}",
        output_summary=answer[:240],
    )
    return ChatResponse(answer=answer)


@app.get("/observability/events", response_model=list[InferenceEventOut])
def observability_events(limit: int = 50, db: Session = Depends(get_db)) -> list[InferenceEventOut]:
    safe_limit = max(1, min(limit, 200))
    return db.query(InferenceEvent).order_by(InferenceEvent.created_at.desc()).limit(safe_limit).all()


@app.get("/model/performance", response_model=ModelPerformanceOut)
def model_performance(db: Session = Depends(get_db)) -> ModelPerformanceOut:
    metrics = get_model_performance(db)
    return ModelPerformanceOut(**metrics)


@app.post("/model/feedback", response_model=PredictionFeedbackOut)
def model_feedback(payload: PredictionFeedbackIn, db: Session = Depends(get_db)) -> PredictionFeedbackOut:
    item = add_prediction_feedback(
        db,
        property_id=payload.property_id,
        model_name=settings.ollama_model,
        predicted_12m_change_percent=payload.predicted_12m_change_percent,
        actual_12m_change_percent=payload.actual_12m_change_percent,
        confidence=payload.confidence,
        recommendation=payload.recommendation,
    )
    return PredictionFeedbackOut.model_validate(item)
