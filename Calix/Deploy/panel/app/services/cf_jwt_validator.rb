# Valida JWTs de Cloudflare Access
# Cachea las JWKS keys para evitar requests en cada validación
class CfJwtValidator
  JWKS_URL = 'https://%<team_domain>s/cdn-cgi/access/certs'
  CACHE_TTL = 1.hour

  class << self
    def validate(token)
      return nil if token.blank?

      # Decodificar sin verificar para obtener el header
      unverified = JWT.decode(token, nil, false)
      unverified[1]
      payload = unverified[0]

      # Verificar audience
      auds = ENV.fetch('CF_ACCESS_AUDS', '').split(',').map(&:strip)
      token_aud = payload['aud']

      unless auds.any? { |aud| token_aud.is_a?(Array) ? token_aud.include?(aud) : token_aud == aud }
        Rails.logger.warn "JWT aud mismatch: #{token_aud} not in #{auds}"
        return nil
      end

      # Obtener JWKS y verificar firma
      jwks = fetch_jwks(payload['iss'])

      decoded = JWT.decode(
        token,
        nil,
        true,
        {
          algorithms: ['RS256'],
          jwks: jwks
        }
      )

      decoded[0]
    rescue JWT::DecodeError => e
      Rails.logger.warn "JWT decode error: #{e.message}"
      nil
    rescue StandardError => e
      Rails.logger.error "JWT validation error: #{e.message}"
      nil
    end

    private

    def fetch_jwks(issuer)
      cache_key = "cf_jwks:#{issuer}"

      Rails.cache.fetch(cache_key, expires_in: CACHE_TTL) do
        # El issuer es como https://teamname.cloudflareaccess.com
        url = "#{issuer}/cdn-cgi/access/certs"

        response = Faraday.get(url)
        raise "Failed to fetch JWKS: #{response.status}" unless response.success?

        JSON.parse(response.body)
      end
    end
  end
end
