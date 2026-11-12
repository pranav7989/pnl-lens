# @file  services/market-iq/tests/conftest.py
# @area  Tests
# @what  Test setup: the daily jobs never start during tests.
import os

os.environ["MARKET_IQ_SCHEDULER"] = "off"   # tests never start the real daily jobs
