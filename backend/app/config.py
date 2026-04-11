from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "NETFLOW API"
    database_url: str = "sqlite:///./netflow.db"
    local_listings_path: str = "data/listings.csv"

    fred_api_key: str | None = None
    news_api_key: str | None = None

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"

    langsmith_api_key: str | None = None
    langsmith_tracing: bool = False
    langsmith_project: str = "netflow-mvp"
    langsmith_endpoint: str = "https://api.smith.langchain.com"


settings = Settings()
