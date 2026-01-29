class CreateRepos < ActiveRecord::Migration[7.2]
  def change
    create_table :repos do |t|
      t.references :user, null: false, foreign_key: true
      t.string :full_name, null: false # owner/repo
      t.boolean :selected, default: false

      t.timestamps
    end

    add_index :repos, %i[user_id full_name], unique: true
    add_index :repos, %i[user_id selected]
  end
end
