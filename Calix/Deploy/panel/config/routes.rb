Rails.application.routes.draw do
  # Health check (para install.sh y doctor.sh)
  get 'health', to: 'health#show'

  # ForwardAuth endpoint para Traefik
  # Valida JWT de Cloudflare Access y owner isolation
  get 'auth/traefik', to: 'auth#traefik'

  # Dashboard principal
  root 'dashboard#index'

  # Gestión de repos
  resources :repos, only: [:index] do
    collection do
      post :refresh
    end
    member do
      post :select
    end
  end

  # Gestión de instancia (1 por usuario)
  resource :instance, only: [:show] do
    post :start
    post :stop
  end

  # Settings del usuario (GH_TOKEN, MCP keys)
  resource :settings, only: %i[edit update]
end
