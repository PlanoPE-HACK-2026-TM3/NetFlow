from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PortfolioItem(Base):
    __tablename__ = "portfolio_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    property_id: Mapped[str] = mapped_column(String(128), index=True)
    address: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(128))
    state: Mapped[str] = mapped_column(String(64))
    price: Mapped[float] = mapped_column(Float)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class InferenceEvent(Base):
    __tablename__ = "inference_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    operation: Mapped[str] = mapped_column(String(64), index=True)
    success: Mapped[bool] = mapped_column(default=True)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    fallback_used: Mapped[bool] = mapped_column(default=False)
    provider: Mapped[str] = mapped_column(String(64), default="unknown")
    input_summary: Mapped[str] = mapped_column(Text, default="")
    output_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PredictionFeedback(Base):
    __tablename__ = "prediction_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    property_id: Mapped[str] = mapped_column(String(128), index=True)
    model_name: Mapped[str] = mapped_column(String(128), default="llama3.1:8b")
    predicted_12m_change_percent: Mapped[float] = mapped_column(Float)
    actual_12m_change_percent: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    recommendation: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
