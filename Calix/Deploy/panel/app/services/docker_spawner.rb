# Gestiona contenedores Docker para usuarios
# Usa docker-socket-proxy para acceso seguro
class DockerSpawner
  OPENCODE_IMAGE = 'calix-opencode:latest'
  NETWORK = 'calix'

  class << self
    def start(user, repo)
      container_name = "opencode-#{user.slug}"

      # Si ya existe, detener primero
      stop(user) if container_exists?(container_name)

      # Paths en el host
      user_data_root = ENV.fetch('CALIX_USER_DATA_ROOT', '/data/users')
      user_dir = "#{user_data_root}/#{user.slug}"
      workspace_dir = "#{user_dir}/workspaces/#{repo.workspace_key}"

      # Asegurar que existen los directorios
      FileUtils.mkdir_p("#{user_dir}/config")
      FileUtils.mkdir_p("#{user_dir}/cache")
      FileUtils.mkdir_p("#{user_dir}/share")
      FileUtils.mkdir_p(workspace_dir)

      # Crear contenedor
      container = Docker::Container.create(
        'name' => container_name,
        'Image' => OPENCODE_IMAGE,
        'Env' => [
          "GH_TOKEN=#{user.gh_token}",
          "GIT_USER_NAME=#{user.email.split('@').first}",
          "GIT_USER_EMAIL=#{user.email}"
        ],
        'HostConfig' => {
          'Binds' => [
            "#{workspace_dir}:/workspace",
            "#{user_dir}/config:/root/.config/opencode",
            "#{user_dir}/cache:/root/.cache/opencode",
            "#{user_dir}/share:/root/.local/share/opencode"
          ],
          'NetworkMode' => NETWORK
        },
        'Labels' => {
          'traefik.enable' => 'true',
          "traefik.http.routers.#{container_name}.rule" =>
            "Host(`#{ENV['CALIX_USER_SUBDOMAIN_PREFIX']}#{user.slug}.#{ENV['CALIX_DOMAIN']}`)",
          "traefik.http.routers.#{container_name}.entrypoints" => 'web',
          "traefik.http.routers.#{container_name}.middlewares" => 'calix-forward-auth@docker',
          "traefik.http.services.#{container_name}.loadbalancer.server.port" => '4096',
          'calix.user' => user.slug,
          'calix.repo' => repo.full_name
        }
      )

      container.start

      container.id
    rescue Docker::Error::DockerError => e
      Rails.logger.error "Docker error starting container: #{e.message}"
      raise
    end

    def stop(user)
      container_name = "opencode-#{user.slug}"

      return unless container_exists?(container_name)

      container = Docker::Container.get(container_name)
      container.stop(timeout: 10)
      container.remove

      true
    rescue Docker::Error::DockerError => e
      Rails.logger.error "Docker error stopping container: #{e.message}"
      # Intentar forzar eliminación
      begin
        container = Docker::Container.get(container_name)
        container.remove(force: true)
      rescue StandardError
        nil
      end
      false
    end

    def status(user)
      container_name = "opencode-#{user.slug}"

      return :stopped unless container_exists?(container_name)

      container = Docker::Container.get(container_name)
      state = container.info['State']

      if state['Running']
        :running
      elsif state['Restarting']
        :starting
      else
        :stopped
      end
    rescue Docker::Error::DockerError
      :stopped
    end

    private

    def container_exists?(name)
      Docker::Container.get(name)
      true
    rescue Docker::Error::NotFoundError
      false
    end
  end
end
