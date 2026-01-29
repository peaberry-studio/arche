# Job que se ejecuta periódicamente para detener instancias inactivas
class IdleReaperJob < ApplicationJob
  queue_as :default

  def perform
    idle_minutes = ENV.fetch('INSTANCE_IDLE_MINUTES', 30).to_i
    cutoff = idle_minutes.minutes.ago

    Instance.where(status: :running).find_each do |instance|
      next if instance.last_seen_at.nil?
      next if instance.last_seen_at > cutoff

      Rails.logger.info "Stopping idle instance for user #{instance.user.slug}"

      DockerSpawner.stop(instance.user)
      instance.update!(status: :stopped, container_id: nil)
    end

    # Re-encolar para la próxima ejecución
    IdleReaperJob.set(wait: 5.minutes).perform_later
  end
end
