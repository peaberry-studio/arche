class DashboardController < ApplicationController
  def index
    @repos = current_user.repos.order(:full_name)
    @instance = current_user.instance
    @selected_repo = current_user.selected_repo
  end
end
