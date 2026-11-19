cask "stillnote" do
  version "1.5.1"
  sha256 "7aea6caa986a4e10e5a38b51ab6c47e7411c9f17e7e7991673a371e0665be996"

  url "https://github.com/Infekted11/Stillnote/releases/download/v#{version}/Stillnote-#{version}-universal.dmg"
  name "Stillnote"
  desc "Local-first Markdown workspace"
  homepage "https://infekted11.github.io/Stillnote/"

  depends_on macos: :ventura

  app "Stillnote.app"
end
