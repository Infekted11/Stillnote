cask "stillnote" do
  version "1.5.2"
  sha256 "d2dce94d6df7b026053a21643b7ef255cf9c64e5d719ef980b790d75bff2e8e2"

  url "https://github.com/Infekted11/Stillnote/releases/download/v#{version}/Stillnote-#{version}-universal.dmg"
  name "Stillnote"
  desc "Local-first Markdown workspace"
  homepage "https://infekted11.github.io/Stillnote/"

  depends_on macos: :ventura

  app "Stillnote.app"
end
