class Repo < ApplicationRecord
  belongs_to :user

  validates :full_name, presence: true
  validates :full_name, uniqueness: { scope: :user_id }

  scope :selected, -> { where(selected: true) }

  # Formato: owner/repo
  def owner
    full_name.split('/').first
  end

  def name
    full_name.split('/').last
  end

  # Key para el workspace (sanitizado)
  def workspace_key
    full_name.gsub('/', '_')
  end
end
