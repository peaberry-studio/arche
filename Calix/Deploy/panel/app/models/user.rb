class User < ApplicationRecord
  has_many :repos, dependent: :destroy
  has_one :instance, dependent: :destroy

  # Cifrado del GH_TOKEN
  encrypts :gh_token

  # Slug único para el subdominio (no derivado del email por privacidad)
  before_create :generate_slug

  validates :email, presence: true, uniqueness: true
  validates :slug, presence: true, uniqueness: true, on: :update

  def selected_repo
    repos.find_by(selected: true)
  end

  def session_url
    prefix = ENV.fetch('CALIX_USER_SUBDOMAIN_PREFIX', 'u-')
    domain = ENV['CALIX_DOMAIN']
    scheme = ENV.fetch('CALIX_SCHEME', 'https')
    "#{scheme}://#{prefix}#{slug}.#{domain}"
  end

  private

  def generate_slug
    self.slug ||= SecureRandom.alphanumeric(8).downcase
  end
end
