# Job para refrescar la lista de repos de un usuario desde GitHub
class RepoRefreshJob < ApplicationJob
  queue_as :default

  def perform(user_id)
    user = User.find(user_id)
    return if user.gh_token.blank?

    allowed_orgs = ENV.fetch('ALLOWED_GH_ORGS', '').split(',').map(&:strip)
    allowed_repos = ENV.fetch('ALLOWED_GH_REPOS', '').split(',').map(&:strip)

    # Fetch repos from GitHub
    repos = fetch_github_repos(user.gh_token)

    # Filtrar por orgs/repos permitidos
    filtered = repos.select do |repo|
      owner = repo[:full_name].split('/').first

      if allowed_repos.any?
        allowed_repos.include?(repo[:full_name])
      elsif allowed_orgs.any?
        allowed_orgs.include?(owner)
      else
        true
      end
    end

    # Sync con la DB
    existing_names = user.repos.pluck(:full_name)
    new_names = filtered.map { |r| r[:full_name] }

    # Crear nuevos
    (new_names - existing_names).each do |full_name|
      user.repos.create!(full_name: full_name)
    end

    # Eliminar los que ya no están accesibles (pero conservar selected)
    user.repos.where.not(full_name: new_names).where(selected: false).destroy_all

    Rails.logger.info "Refreshed #{filtered.size} repos for user #{user.email}"
  end

  private

  def fetch_github_repos(token)
    repos = []
    page = 1

    loop do
      response = Faraday.get('https://api.github.com/user/repos') do |req|
        req.headers['Authorization'] = "Bearer #{token}"
        req.headers['Accept'] = 'application/vnd.github+json'
        req.params['per_page'] = 100
        req.params['page'] = page
        req.params['sort'] = 'updated'
      end

      break unless response.success?

      batch = JSON.parse(response.body)
      break if batch.empty?

      repos.concat(batch.map { |r| { full_name: r['full_name'] } })
      page += 1

      # Safety limit
      break if page > 10
    end

    repos
  end
end
