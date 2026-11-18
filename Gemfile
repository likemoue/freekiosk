source 'https://rubygems.org'

# You may use http://rbenv.org/ or https://rvm.io/ to install and use this version
ruby ">= 2.6.10"

# Exclude problematic versions of cocoapods and activesupport that causes build failures.
gem 'cocoapods', '>= 1.13', '!= 1.15.0', '!= 1.15.1'
# 7.2.3.1 is past GHSA-2j26-frm8-cmj9, GHSA-89vf-4333-qx8v and GHSA-cg4j-q9v8-6v38 (it needs Ruby 3.1).
# GHSA-8474-xrp6-wh69 is fixed only from 8.0.5.2, and CocoaPods 1.16 and 1.17 want activesupport below 8.
# Only an iOS build reads this file, and this fork builds for Android only.
gem 'activesupport', '>= 7.2.3.1'
gem 'xcodeproj', '< 1.26.0'
# Was '< 1.3.4', to stay off the release that stopped loading `logger` and broke older activesupport.
# activesupport 7.2 loads it itself; 1.3.7 fixes GHSA-h8w8-99g7-qmvj, GHSA-6wx8-w4f5-wwcr and GHSA-wv3x-4vxv-whpp.
gem 'concurrent-ruby', '>= 1.3.7'

# Ruby 3.4.0 has removed some libraries from the standard library.
gem 'bigdecimal'
gem 'logger'
gem 'benchmark'
gem 'mutex_m'
