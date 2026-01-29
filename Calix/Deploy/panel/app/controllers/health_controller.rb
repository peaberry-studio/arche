class HealthController < ActionController::Base
  # No requiere autenticación
  skip_before_action :verify_authenticity_token, raise: false

  def show
    render json: {
      status: 'ok',
      timestamp: Time.current.iso8601,
      version: ENV.fetch('CALIX_VERSION', 'dev')
    }
  end
end
