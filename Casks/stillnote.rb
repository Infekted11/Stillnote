cask "stillnote" do
  version "1.4.12"
  sha256 "9595988fcb6c5fc649363200583f7e3e3310a58bf28c44d3019f5535047f2f4d"

  url "https://github.com/Infekted11/Stillnote/releases/download/v#{version}/Stillnote-#{version}-universal.dmg"
  name "Stillnote"
  desc "Local-first Markdown workspace"
  homepage "https://infekted11.github.io/Stillnote/"

  depends_on macos: :ventura

  app "Stillnote.app"
end
