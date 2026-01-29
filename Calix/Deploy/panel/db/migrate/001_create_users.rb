class CreateUsers < ActiveRecord::Migration[7.2]
  def change
    create_table :users do |t|
      t.string :email, null: false
      t.string :slug, null: false
      t.text :gh_token_ciphertext # Cifrado con Lockbox

      t.timestamps
    end

    add_index :users, :email, unique: true
    add_index :users, :slug, unique: true
  end
end
