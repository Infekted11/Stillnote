cask "stillnote" do
  version "1.4.10"
  sha256 "7112494e06d293c780da76ba581b1ff6f11ac34bafcad32a383c0a15c0ef9685"

  url "https://github.com/Infekted11/Stillnote/releases/download/v#{version}/Stillnote-#{version}-universal.dmg"
  name "Stillnote"
  desc "Local-first Markdown workspace"
  homepage "https://infekted11.github.io/Stillnote/"

  depends_on macos: :ventura

  app "Stillnote.app"
end
