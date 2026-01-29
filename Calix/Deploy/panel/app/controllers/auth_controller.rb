class AuthController < ActionController::Base
  # Endpoint para Traefik forwardAuth
  # Valida:
  # 1. JWT de Cloudflare Access válido
  # 2. El Host del request corresponde al usuario autenticado (owner isolation)

  def traefik
    jwt = request.headers['Cf-Access-Jwt-Assertion']

    # Sin JWT = no autenticado
    if jwt.blank?
      head :unauthorized
      return
    end

    # Validar JWT
    payload = CfJwtValidator.validate(jwt)
    if payload.nil?
      head :unauthorized
      return
    end

    email = payload['email']
    if email.blank?
      head :unauthorized
      return
    end

    # Owner isolation: verificar que el Host corresponde al usuario
    host = request.headers['X-Forwarded-Host'] || request.host

    # Si es el dominio principal (panel), permitir
    if host == ENV['CALIX_DOMAIN']
      head :ok
      return
    end

    # Si es subdominio de usuario, verificar ownership
    prefix = ENV.fetch('CALIX_USER_SUBDOMAIN_PREFIX', 'u-')
    domain = ENV['CALIX_DOMAIN']

    if host =~ /^#{Regexp.escape(prefix)}([a-z0-9]+)\.#{Regexp.escape(domain)}$/
      slug = ::Regexp.last_match(1)
      user = User.find_by(email: email)

      if user && user.slug == slug
        head :ok
      else
        # Usuario intentando acceder a sesión de otro
        Rails.logger.warn "Owner isolation violation: #{email} tried to access #{host}"
        head :forbidden
      end
    else
      # Host no reconocido
      head :forbidden
    end
  end
end
