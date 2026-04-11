from __future__ import annotations

from math import sqrt

from sqlalchemy.orm import Session

from app.models import InferenceEvent, PredictionFeedback


def log_inference_event(
    db: Session,
    *,
    operation: str,
    success: bool,
    latency_ms: float,
    fallback_used: bool,
    provider: str,
    input_summary: str,
    output_summary: str,
) -> InferenceEvent:
    event = InferenceEvent(
        operation=operation,
        success=success,
        latency_ms=latency_ms,
        fallback_used=fallback_used,
        provider=provider,
        input_summary=input_summary,
        output_summary=output_summary,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def add_prediction_feedback(
    db: Session,
    *,
    property_id: str,
    model_name: str,
    predicted_12m_change_percent: float,
    actual_12m_change_percent: float,
    confidence: float,
    recommendation: str,
) -> PredictionFeedback:
    feedback = PredictionFeedback(
        property_id=property_id,
        model_name=model_name,
        predicted_12m_change_percent=predicted_12m_change_percent,
        actual_12m_change_percent=actual_12m_change_percent,
        confidence=confidence,
        recommendation=recommendation,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


def get_calibration_shift(db: Session) -> float:
    rows = db.query(PredictionFeedback).all()
    if not rows:
        return 0.0
    avg_error = sum(r.actual_12m_change_percent - r.predicted_12m_change_percent for r in rows) / len(rows)
    return round(max(-8.0, min(8.0, avg_error)), 3)


def get_model_performance(db: Session) -> dict:
    rows = db.query(PredictionFeedback).all()
    if not rows:
        return {
            "feedback_count": 0,
            "mae": None,
            "rmse": None,
            "directional_accuracy": None,
            "avg_error": None,
            "calibration_shift": 0.0,
        }

    errors = [r.actual_12m_change_percent - r.predicted_12m_change_percent for r in rows]
    abs_errors = [abs(e) for e in errors]
    sq_errors = [e * e for e in errors]
    directional_hits = 0
    for r in rows:
        pred_positive = r.predicted_12m_change_percent >= 0
        actual_positive = r.actual_12m_change_percent >= 0
        if pred_positive == actual_positive:
            directional_hits += 1

    return {
        "feedback_count": len(rows),
        "mae": round(sum(abs_errors) / len(abs_errors), 4),
        "rmse": round(sqrt(sum(sq_errors) / len(sq_errors)), 4),
        "directional_accuracy": round(directional_hits / len(rows), 4),
        "avg_error": round(sum(errors) / len(errors), 4),
        "calibration_shift": get_calibration_shift(db),
    }