require_relative 'boot'

require 'rails'
require 'active_model/railtie'
require 'active_job/railtie'
require 'active_record/railtie'
require 'action_controller/railtie'
require 'action_view/railtie'

Bundler.require(*Rails.groups)

module CalixPanel
  class Application < Rails::Application
    config.load_defaults 7.2

    # Autoload paths
    config.autoload_lib(ignore: %w[assets tasks])

    # SQLite for everything
    config.active_record.default_sqlite_database = ENV.fetch('DATABASE_PATH', 'db/production.sqlite3')

    # Solid Queue for background jobs
    config.active_job.queue_adapter = :solid_queue

    # Timezone
    config.time_zone = 'UTC'

    # API-friendly but with views
    config.api_only = false

    # Log to STDOUT in production
    if ENV['RAILS_LOG_TO_STDOUT'].present?
      config.logger = ActiveSupport::Logger.new($stdout)
                                           .tap  { |logger| logger.formatter = ::Logger::Formatter.new }
                                           .then { |logger| ActiveSupport::TaggedLogging.new(logger) }
    end
  end
end
