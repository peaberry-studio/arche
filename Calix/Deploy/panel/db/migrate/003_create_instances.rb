class CreateInstances < ActiveRecord::Migration[7.2]
  def change
    create_table :instances do |t|
      t.references :user, null: false, foreign_key: true
      t.integer :status, default: 0 # enum: stopped, starting, running, stopping
      t.string :container_id
      t.datetime :last_seen_at
      t.datetime :started_at

      t.timestamps
    end

    add_index :instances, :user_id, unique: true
    add_index :instances, :status
  end
end
