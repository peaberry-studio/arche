class ApplicationController < ActionController::Base
  before_action :authenticate_via_cloudflare_access!

  helper_method :current_user

  private

  # Valida el JWT de Cloudflare Access y carga/crea el usuario
  def authenticate_via_cloudflare_access!
    jwt = request.headers['Cf-Access-Jwt-Assertion']

    if jwt.blank?
      render plain: 'Unauthorized: Missing Cf-Access-Jwt-Assertion', status: :unauthorized
      return
    end

    payload = CfJwtValidator.validate(jwt)

    if payload.nil?
      render plain: 'Unauthorized: Invalid JWT', status: :unauthorized
      return
    end

    email = payload['email']
    if email.blank?
      render plain: 'Unauthorized: No email in JWT', status: :unauthorized
      return
    end

    @current_user = User.find_or_create_by!(email: email)
  rescue StandardError => e
    Rails.logger.error "Auth error: #{e.message}"
    render plain: "Unauthorized: #{e.message}", status: :unauthorized
  end

  attr_reader :current_user
end
