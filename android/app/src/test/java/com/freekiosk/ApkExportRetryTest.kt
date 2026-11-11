package com.freekiosk

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which answers to a part are worth another try. Cloudflare's 524 (no answer in 100 seconds) ended the
 * sending of Chrome from two Lenovos on a slow link at once, as if the server had refused the file.
 */
class ApkExportRetryTest {
  @Test
  fun aGatewayThatGaveUpOrABusyServerIsTriedAgain() {
    for (code in listOf(524, 522, 502, 503, 504, 500, 408, 429)) assertTrue("$code", ApkExportModule.retryable(code))
  }

  @Test
  fun aRefusalIsNot() {
    for (code in listOf(400, 401, 403, 404, 409, 413)) assertFalse("$code", ApkExportModule.retryable(code))
  }
}
