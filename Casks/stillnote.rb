cask "stillnote" do
  version "1.4.11"
  sha256 "ed390ef4228fce8edae7e7883121154a106c68da0ad2f5760dde681fd871b555"

  url "https://github.com/Infekted11/Stillnote/releases/download/v#{version}/Stillnote-#{version}-universal.dmg"
  name "Stillnote"
  desc "Local-first Markdown workspace"
  homepage "https://infekted11.github.io/Stillnote/"

  depends_on macos: :ventura

  app "Stillnote.app"
end
