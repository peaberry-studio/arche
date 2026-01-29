class Instance < ApplicationRecord
  belongs_to :user

  # Estados: stopped, starting, running, stopping
  enum :status, { stopped: 0, starting: 1, running: 2, stopping: 3 }

  def container_name
    "opencode-#{user.slug}"
  end

  def running?
    status == 'running' && container_id.present?
  end
end
