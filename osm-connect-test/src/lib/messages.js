// Message catalogue (FRD 13 and 14).
//
// Every significant outcome resolves to one of these entries. Each carries a
// permanent code, a plain-English explanation, an explicit statement of what has
// NOT happened, recommended actions and a retry classification (FR-ERR-008).

const RETRY = {
  SAFE_NOW: 'Safe now',
  SAFE_AFTER_DELAY: 'Safe after a delay',
  AFTER_CONFIG: 'Safe only after configuration changes',
  NOT_RECOMMENDED: 'Not recommended',
  DISABLED: 'Disabled'
};

const CATALOGUE = {
  // --- 14.1 Connection ------------------------------------------------------
  'OSM-CONN-001': {
    status: 'Information',
    title: 'Ready to connect to OSM',
    what: 'The application configuration required to begin an OSM connection is present. When you continue, you will be redirected to Online Scout Manager to sign in. Your OSM password will be entered on the OSM website and will not be supplied to this application.',
    means: 'The connection process has not started yet.',
    notHappened: 'No information has been sent to OSM.',
    actions: ['Select Continue to OSM.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-CONN-002': {
    status: 'Information',
    title: 'An OSM connection is already available',
    what: 'A previous OSM connection is stored for this account. The application will first check whether the existing connection remains valid. You will only be redirected to OSM if the existing access can no longer be used.',
    means: 'You may not need to sign in to OSM again.',
    notHappened: 'No OSM information has been changed.',
    actions: ['Select Check existing connection.', 'Or select Disconnect and start again.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-CONN-003': {
    status: 'Error',
    title: 'The application is not ready to connect',
    what: 'One or more items required to start an OSM connection have not been configured. The connection process has not started and no information has been sent to OSM.',
    means: 'No OSM test can run until the configuration is complete.',
    notHappened: 'No connection attempt was created and nothing was sent to OSM.',
    causes: [
      'OSM client identifier missing.',
      'OSM client secret missing.',
      'Callback address missing.',
      'Authorisation endpoint missing.',
      'Token endpoint missing.',
      'API base address missing.'
    ],
    actions: ['Ask an application administrator to review the OSM connection configuration.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-CONN-004': {
    status: 'Information',
    title: 'Redirecting you to Online Scout Manager',
    what: 'A secure connection attempt has been created. Your browser is being redirected to OSM, where you can sign in and decide whether to allow this application to connect.',
    means: 'This connection attempt will expire if it is not completed within the configured time.',
    notHappened: 'No access token has been requested.',
    actions: ['Complete the sign in on the OSM website.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-CONN-005': {
    status: 'Error',
    title: 'The browser did not reach OSM',
    what: 'The application prepared a secure OSM connection request, but your browser did not complete the redirect. No authentication information has been received.',
    means: 'The connection did not start.',
    notHappened: 'No token was requested and no OSM information was retrieved.',
    causes: [
      'A browser extension blocked the redirect.',
      'The page was closed.',
      'The browser prevented navigation.',
      'A network or DNS issue occurred.',
      'The configured OSM authorisation address is incorrect.'
    ],
    actions: ['It is safe to start a new connection attempt.'],
    retry: RETRY.SAFE_NOW
  },

  // --- 14.2 Callback --------------------------------------------------------
  'OSM-CALLBACK-001': {
    status: 'Information',
    title: 'OSM returned control to the application',
    what: 'The application has received a response from OSM and is validating it before requesting an access token. No OSM data tests have been run yet.',
    means: 'Validation is in progress.',
    notHappened: 'No OSM information has been retrieved.',
    actions: ['No action is needed.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-CALLBACK-002': {
    status: 'Warning',
    title: 'OSM access was not authorised',
    what: 'The OSM authorisation process ended without permission being granted to this application. No access token was created and no OSM information was retrieved.',
    means: 'The application cannot run any OSM test.',
    notHappened: 'No token was created and no OSM information was read or changed.',
    actions: ['Return to the home page.', 'Or begin the connection process again.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-CALLBACK-003': {
    status: 'Error',
    title: 'OSM did not return an authorisation code',
    what: 'The application received a callback, but the information required to complete the connection was missing. The application has stopped the connection process.',
    means: 'The connection cannot continue.',
    notHappened: 'No token was requested.',
    causes: [
      'Access was declined.',
      'The callback was incomplete.',
      'The authorisation session expired.',
      'The OSM connection process changed.',
      'The callback address was opened directly rather than through OSM.'
    ],
    actions: ['Start a new connection attempt.', 'If the problem continues, export the diagnostic report.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-CALLBACK-004': {
    status: 'Critical',
    title: 'The connection response could not be verified',
    what: 'The security value returned with the OSM response did not match the value created when the connection started. The application has rejected the response and will not request an access token.',
    means: 'The connection cannot safely continue.',
    notHappened: 'No token has been requested and no OSM information has been retrieved.',
    actions: ['Close any other open connection tabs.', 'Start again from the application home page.'],
    retry: RETRY.NOT_RECOMMENDED,
    retryNote: 'A new connection attempt is safe. The current callback must not be retried.'
  },
  'OSM-CALLBACK-005': {
    status: 'Error',
    title: 'The OSM connection attempt expired',
    what: 'The response arrived after the secure connection attempt had expired. The application has rejected the callback.',
    means: 'The connection did not complete.',
    notHappened: 'No token was requested.',
    actions: ['Start a new connection attempt and complete the OSM sign in without returning to an older browser tab.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-CALLBACK-006': {
    status: 'Warning',
    title: 'This OSM response has already been processed',
    what: 'The callback relates to a connection attempt that has already been completed or rejected. Authorisation codes must not be reused.',
    means: 'This callback has been ignored.',
    notHappened: 'No second token request was made.',
    actions: ['Return to the connection dashboard.', 'Start a new connection only if the dashboard shows that no valid connection exists.'],
    retry: RETRY.NOT_RECOMMENDED
  },

  // --- 14.3 Tokens ----------------------------------------------------------
  'OSM-TOKEN-001': {
    status: 'Information',
    title: 'Completing the secure OSM connection',
    what: 'The application has validated the callback and is securely exchanging the temporary authorisation code for an access token. This request is being completed by the application server.',
    means: 'The client secret stays on the server.',
    notHappened: 'No OSM information has been read.',
    actions: ['No action is needed.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-TOKEN-002': {
    status: 'Success',
    title: 'The OSM connection was created successfully',
    what: 'OSM accepted the authorisation code and returned an access token. The token has been encrypted and stored securely. The application will now make a small authenticated request to confirm that the token works.',
    means: 'Authentication has succeeded. It does not yet prove that any particular test will be permitted.',
    notHappened: 'No OSM information has been changed.',
    actions: ['Run the guided test.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-TOKEN-003': {
    status: 'Error',
    title: 'OSM did not issue an access token',
    what: 'OSM rejected the request to exchange the authorisation code for an access token. The application cannot continue to the API tests.',
    means: 'No authenticated request can be made.',
    notHappened: 'No OSM information was read or changed.',
    causes: [
      'Incorrect client identifier.',
      'Incorrect client secret.',
      'Callback address mismatch.',
      'Expired authorisation code.',
      'Authorisation code already used.',
      'OSM developer application disabled.',
      'OSM token endpoint changed.',
      'Temporary OSM service issue.'
    ],
    actions: ['Do not repeatedly retry this request.', 'An administrator should review the configuration and diagnostic details.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-TOKEN-004': {
    status: 'Error',
    title: 'OSM returned an unexpected token response',
    what: 'OSM responded to the token request, but the response did not contain the expected access token information. The response has been sanitised and recorded for diagnosis.',
    means: 'The application cannot safely treat the connection as complete.',
    notHappened: 'No connection has been stored.',
    actions: ['Export the diagnostic report.', 'Ask a developer to compare the received response with the current OSM connection behaviour.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-TOKEN-005': {
    status: 'Warning',
    title: 'The OSM access token has expired',
    what: 'The stored access token is no longer valid. The application will attempt one refresh where a refresh token is available.',
    means: 'One controlled refresh will be attempted.',
    notHappened: 'No OSM information has been changed.',
    actions: ['Wait for the refresh result.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-TOKEN-006': {
    status: 'Success',
    title: 'OSM access was renewed successfully',
    what: 'OSM accepted the refresh request and issued replacement token information. The replacement information has been stored securely and the interrupted read only test can continue.',
    means: 'Testing can continue.',
    notHappened: 'No OSM information has been changed.',
    actions: ['Continue testing.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-TOKEN-007': {
    status: 'Error',
    title: 'The OSM connection must be renewed',
    what: 'OSM did not accept the stored refresh token. The previous token information is no longer usable and has been removed.',
    means: 'You must sign in to OSM again.',
    notHappened: 'No OSM information has been changed.',
    actions: ['Select Reconnect to OSM.'],
    retry: RETRY.AFTER_CONFIG
  },

  // --- 14.4 API -------------------------------------------------------------
  'OSM-API-001': {
    status: 'Information',
    title: 'Sending a read only request to OSM',
    what: 'The application has prepared an authenticated request for the selected test. The request does not contain an instruction to change OSM information.',
    means: 'A read only request is in progress.',
    notHappened: 'Nothing in OSM will be changed by this request.',
    actions: ['No action is needed.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-API-002': {
    status: 'Success',
    title: 'OSM returned a successful response',
    what: 'OSM accepted the request and returned a response in a recognised format. The application has completed its initial validation and will now inspect the response structure.',
    means: 'The connection is working.',
    notHappened: 'No OSM information was changed.',
    actions: ['No action is needed.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-API-003': {
    status: 'Warning',
    title: 'OSM responded, but the structure has changed',
    what: 'The request completed successfully at the network level, but the response does not match the structure currently expected by the application.',
    means: 'The connection is working, but this particular integration may require an update.',
    notHappened: 'No OSM information was changed.',
    actions: ['Review the schema comparison.', 'Export a developer diagnostic report.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-API-004': {
    status: 'Warning',
    title: 'OSM returned no response content',
    what: 'OSM returned a response without usable content. This may be valid for some operations, but content was expected for this test.',
    means: 'The test could not be verified.',
    notHappened: 'No OSM information was changed.',
    actions: ['Review the HTTP status and response headers.', 'It is safe to retry once unless another warning says otherwise.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-API-005': {
    status: 'Warning',
    title: 'The OSM response format was not recognised',
    what: 'OSM returned content using a format that this test does not currently support. The application has not attempted to interpret the content as member or section information.',
    means: 'The response could not be validated.',
    notHappened: 'No OSM information was changed and no content was interpreted.',
    actions: ['Review the sanitised content type and response preview.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-API-006': {
    status: 'Error',
    title: 'OSM rejected the stored authentication',
    what: 'The request reached OSM, but OSM did not accept the access token. The application will not continue sending authenticated requests with this token.',
    means: 'The stored connection may have expired or been revoked.',
    notHappened: 'No OSM information was changed.',
    actions: ['The application will attempt a single refresh where possible.', 'Otherwise, reconnect to OSM.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-API-007': {
    status: 'Warning',
    title: 'Your OSM account does not have permission for this test',
    what: 'The OSM connection is valid, but OSM has refused this particular request. This commonly means that your OSM role does not provide the required access for the selected section.',
    means: 'Other tests may still work.',
    notHappened: 'No OSM information was read or changed.',
    actions: ['Select a different section.', 'Or ask an OSM administrator to review your section permissions.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-API-008': {
    status: 'Warning',
    title: 'OSM could not find the requested information',
    what: 'The request was understood, but OSM could not find information matching the selected section, term or identifier.',
    means: 'A stored reference may be out of date.',
    notHappened: 'No OSM information was changed.',
    causes: [
      'The section is no longer available.',
      'A saved identifier is out of date.',
      'The user’s section access has changed.',
      'The endpoint path has changed.',
      'The requested information does not exist.'
    ],
    actions: ['Refresh the list of groups and sections before retrying.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-API-009': {
    status: 'Error',
    title: 'This OSM operation is no longer available',
    what: 'OSM reported that the endpoint or operation has been removed. The application has disabled further automatic attempts for this test.',
    means: 'The endpoint is Removed, not temporarily unavailable.',
    notHappened: 'No OSM information was changed.',
    actions: ['A developer must identify the replacement operation and update the test configuration.'],
    retry: RETRY.DISABLED
  },
  'OSM-API-010': {
    status: 'Error',
    title: 'OSM rejected the request details',
    what: 'The request reached OSM, but one or more supplied parameters were not accepted. The application will not automatically resend the same request.',
    means: 'Repeating an invalid request risks the client being blocked.',
    notHappened: 'No OSM information was changed.',
    actions: ['Review the sanitised parameter names, endpoint configuration and current OSM behaviour.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-API-011': {
    status: 'Warning',
    title: 'OSM has temporarily limited further requests',
    what: 'OSM has reported that the request limit has been reached. The application has stopped the guided test and will not send further automatic requests until the waiting period has passed.',
    means: 'The connection may still be valid. The test has stopped to protect the OSM developer application from further restrictions.',
    notHappened: 'No OSM information was changed.',
    actions: ['Wait until the displayed retry time before running another test.'],
    retry: RETRY.SAFE_AFTER_DELAY
  },
  'OSM-API-012': {
    status: 'Critical',
    title: 'OSM has blocked this application connection',
    what: 'OSM returned information indicating that the application or authenticated client has been blocked. All further OSM requests have been stopped immediately.',
    means: 'Continuing to send requests may make the block more serious.',
    notHappened: 'No OSM information was changed.',
    actions: ['Do not retry.', 'An application administrator must review the diagnostic report and the requests made before the block occurred.'],
    retry: RETRY.DISABLED,
    retryNote: 'Retry disabled. Only an application administrator can clear this state.'
  },
  'OSM-API-013': {
    status: 'Warning',
    title: 'OSM has marked this operation for removal',
    what: 'The request succeeded, but OSM returned a warning indicating that the operation is deprecated or may be removed.',
    means: 'The connection currently works, but a future OSM change may cause this test or integration to fail.',
    notHappened: 'No OSM information was changed.',
    actions: ['Record the deprecation information and plan an integration update.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-API-014': {
    status: 'Error',
    title: 'OSM could not complete the request',
    what: 'The request reached OSM, but OSM reported an internal server error. This does not necessarily indicate a problem with your account or the application configuration.',
    means: 'The failure is most likely at the OSM end.',
    notHappened: 'No OSM information was changed.',
    actions: ['Check the OSM service status.', 'One controlled retry may be offered after a short delay.'],
    retry: RETRY.SAFE_AFTER_DELAY
  },
  'OSM-API-015': {
    status: 'Error',
    title: 'OSM is temporarily unavailable',
    what: 'OSM or an upstream service returned a temporary availability response. The application has paused this test.',
    means: 'The application itself is working.',
    notHappened: 'No OSM information was changed.',
    actions: ['Check the OSM status information before retrying.'],
    retry: RETRY.SAFE_AFTER_DELAY
  },

  // --- 14.5 Network ---------------------------------------------------------
  'OSM-NET-001': {
    status: 'Error',
    title: 'The OSM address could not be found',
    what: 'The application could not resolve the configured OSM server address. No request reached OSM.',
    means: 'The failure happened before OSM was contacted.',
    notHappened: 'No request reached OSM and no information was changed.',
    causes: ['DNS failure.', 'Incorrect API address.', 'Temporary network issue.', 'Firewall or proxy restriction.'],
    actions: ['Ask an administrator to check the configured API address and network access.'],
    retry: RETRY.SAFE_AFTER_DELAY
  },
  'OSM-NET-002': {
    status: 'Error',
    title: 'OSM did not respond within the expected time',
    what: 'The application opened a connection attempt but did not receive a complete response before the timeout expired.',
    means: 'It is not known whether OSM processed the request. Because the request was read only, nothing can have been changed.',
    notHappened: 'No OSM information was changed, because the request was read only.',
    actions: ['It is safe to retry a read only test once.', 'Repeated automatic retries are not permitted.'],
    retry: RETRY.SAFE_AFTER_DELAY
  },
  'OSM-NET-003': {
    status: 'Critical',
    title: 'A secure connection to OSM could not be established',
    what: 'The application could not establish or validate the encrypted HTTPS connection.',
    means: 'The connection cannot be trusted and has been abandoned.',
    notHappened: 'No request was completed and no information was exchanged.',
    causes: [
      'Certificate validation failure.',
      'TLS configuration problem.',
      'Intercepting proxy.',
      'Incorrect server address.',
      'Local device date or time significantly incorrect.'
    ],
    actions: ['Do not bypass certificate validation.', 'Ask an administrator to investigate.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-NET-004': {
    status: 'Error',
    title: 'The connection ended before the response was complete',
    what: 'The request reached the network, but the connection closed before a complete response was received.',
    means: 'The response could not be validated.',
    notHappened: 'No OSM information was changed.',
    actions: ['A single read only retry may be offered.'],
    retry: RETRY.SAFE_AFTER_DELAY
  },

  // --- 14.6 Parsing ---------------------------------------------------------
  'OSM-PARSE-001': {
    status: 'Success',
    title: 'The OSM response was interpreted successfully',
    what: 'The response was in a recognised format and the required connection information was found.',
    means: 'The response structure matches expectations.',
    notHappened: 'No OSM information was changed.',
    actions: ['No action is needed.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-PARSE-002': {
    status: 'Error',
    title: 'The response was not valid JSON',
    what: 'The response claimed to be JSON, but it could not be parsed as valid JSON. A sanitised preview has been retained.',
    means: 'The response could not be interpreted.',
    notHappened: 'No OSM information was changed and no content was interpreted.',
    actions: ['Review the sanitised preview.', 'Export the diagnostic report for a developer.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-PARSE-003': {
    status: 'Warning',
    title: 'A non-standard OSM response wrapper was detected',
    what: 'The response contained additional text around the structured data. The application recognised the wrapper and extracted the underlying data before validation.',
    means: 'Parsing succeeded, but the response is not clean JSON. Some OSM endpoints have historically wrapped content in JavaScript.',
    notHappened: 'No OSM information was changed.',
    actions: ['Record this so the integration keeps its defensive parsing.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-PARSE-004': {
    status: 'Error',
    title: 'Required OSM information was missing',
    what: 'The response was readable, but a field required by this test was not present.',
    means: 'The test cannot be treated as passed.',
    notHappened: 'No OSM information was changed.',
    actions: ['Review the expected and received field comparison.', 'This may indicate an OSM response change.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-PARSE-005': {
    status: 'Warning',
    title: 'An OSM field was returned in a different format',
    what: 'A recognised field was present, but its data type was different from the type expected by the application. For example, a permission value expected as a number may have been returned as text.',
    means: 'The application will not guess the meaning where doing so could grant additional access.',
    notHappened: 'The value has not been interpreted as additional access.',
    actions: ['Review the field comparison and update the endpoint definition once the correct type is confirmed.'],
    retry: RETRY.NOT_RECOMMENDED
  },

  // --- 14.7 Sections and permissions ---------------------------------------
  'OSM-PERM-001': {
    status: 'Success',
    title: 'OSM sections were found',
    what: 'The application found one or more sections associated with your OSM account. Select the section to use for the next test.',
    means: 'Section-dependent tests can now run.',
    notHappened: 'No OSM information was changed.',
    actions: ['Select an active section.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-PERM-002': {
    status: 'Warning',
    title: 'No usable OSM sections were returned',
    what: 'Authentication completed successfully, but OSM did not return a section that can be used by this test application.',
    means: 'Tests that require a section cannot run.',
    notHappened: 'No OSM information was changed.',
    causes: [
      'The account does not have leader or administrator access.',
      'Section access has not been assigned.',
      'The startup response has changed.',
      'The account is associated only with a parent or member profile.',
      'The test is using an unsupported OSM account type.'
    ],
    actions: ['Try an OSM account with leader or administrator access to at least one section.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-PERM-003': {
    status: 'Warning',
    title: 'A required permission was not returned',
    what: 'The selected section is available, but the permission required for this test was not present.',
    means: 'The test has not been run.',
    notHappened: 'No request was sent to OSM for this test.',
    actions: ['Choose another section.', 'Or ask the relevant OSM administrator to review your access.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-PERM-004': {
    status: 'Warning',
    title: 'An unfamiliar OSM permission value was returned',
    what: 'The application received a permission value that it does not currently understand. For safety, the value has not been treated as permission to access additional information.',
    means: 'The value is shown as unknown and grants no access.',
    notHappened: 'No additional access was assumed.',
    actions: ['Record the value so the permission interpretation can be updated.'],
    retry: RETRY.SAFE_NOW
  },

  // --- 14.8 Completion ------------------------------------------------------
  'OSM-TEST-001': {
    status: 'Success',
    title: 'The OSM connection test passed',
    what: 'The application successfully authenticated with OSM, identified at least one accessible section, interpreted the required permissions and completed the selected read only API test.',
    means: 'The OSM integration pattern is proven for this account.',
    notHappened: 'No OSM information was changed.',
    actions: ['Export the diagnostic report if you need a record.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-TEST-002': {
    status: 'Warning',
    title: 'The connection works, but warnings need attention',
    what: 'The essential OSM connection tests completed successfully, but one or more non-critical issues were detected. Examples include an optional response field missing, an endpoint marked as deprecated, a lower than expected rate limit, an unknown optional permission category, or a response slower than the warning threshold.',
    means: 'The connection works today but may need attention.',
    notHappened: 'No OSM information was changed.',
    actions: ['Review each warning stage.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-TEST-003': {
    status: 'Error',
    title: 'The OSM connection test did not complete',
    what: 'One or more essential stages failed. Tests that depended on the failed stage were not run.',
    means: 'The integration is not proven.',
    notHappened: 'No OSM information was changed.',
    actions: ['Review the first failed stage rather than the later skipped stages.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-TEST-004': {
    status: 'Information',
    title: 'The test was cancelled',
    what: 'The user cancelled the test before all stages completed. Requests that had not started were not sent.',
    means: 'Remaining stages were not attempted. Cancellation is not a failure.',
    notHappened: 'No OSM information was changed.',
    actions: ['Run the guided test again when you are ready.'],
    retry: RETRY.SAFE_NOW
  },

  // --- Application-side codes ----------------------------------------------
  'OSM-APP-001': {
    status: 'Success',
    title: 'Local application health checks passed',
    what: 'The database, encryption key and configuration store all responded normally.',
    means: 'Any failure from this point is unlikely to be caused by the test application itself.',
    notHappened: 'Nothing was sent to OSM.',
    actions: ['No action is needed.'],
    retry: RETRY.SAFE_NOW
  },
  'OSM-APP-002': {
    status: 'Critical',
    title: 'A local application health check failed',
    what: 'A component of the test application did not respond normally, so OSM testing has not started.',
    means: 'The problem is inside the test application, not OSM.',
    notHappened: 'Nothing was sent to OSM.',
    actions: ['Review the application health page.', 'Ask an administrator to investigate before testing again.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-APP-003': {
    status: 'Warning',
    title: 'OSM testing is temporarily suspended',
    what: 'Repeated failures exceeded the configured threshold, so the application has stopped calling OSM for a short period.',
    means: 'This protects the OSM developer application from being blocked.',
    notHappened: 'No further requests have been sent.',
    actions: ['Wait until the earliest next test time shown on the dashboard.'],
    retry: RETRY.SAFE_AFTER_DELAY
  },
  'OSM-APP-004': {
    status: 'Error',
    title: 'An unexpected application error occurred',
    what: 'The application encountered a condition it did not expect. The technical detail has been recorded in protected server logging.',
    means: 'The test has stopped at this point.',
    notHappened: 'No OSM information was changed.',
    actions: ['Export the diagnostic report and quote the correlation identifier.'],
    retry: RETRY.NOT_RECOMMENDED
  },
  'OSM-APP-005': {
    status: 'Error',
    title: 'The response was larger than the safe processing limit',
    what: 'OSM returned more content than the application is configured to process, so reading stopped at the configured limit.',
    means: 'The diagnostic preview is truncated and the response was not fully validated.',
    notHappened: 'No OSM information was changed.',
    actions: ['Choose a narrower test.', 'Or ask an administrator to review the maximum response size.'],
    retry: RETRY.AFTER_CONFIG
  },
  'OSM-APP-006': {
    status: 'Error',
    title: 'The request destination was not permitted',
    what: 'The application refused to send a request because the destination host is not on the approved list of OSM hostnames.',
    means: 'This protects against server-side request forgery and misconfiguration.',
    notHappened: 'No request was sent.',
    actions: ['Ask an administrator to review the API base address and the approved hostname list.'],
    retry: RETRY.AFTER_CONFIG
  }
};

function ukTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/London'
  }).format(date);
}

/**
 * Build a display-ready message. Extra fields never overwrite the catalogue text,
 * they only add context that is already sanitised by the caller.
 */
function build(code, extra = {}) {
  const entry = CATALOGUE[code];
  if (!entry) {
    return build('OSM-APP-004', { ...extra, detail: `Unknown message code: ${String(code).slice(0, 40)}` });
  }
  const now = new Date();
  return {
    code,
    status: entry.status,
    title: entry.title,
    whatHappened: entry.what,
    whatThisMeans: extra.means || entry.means,
    whatHasNotHappened: entry.notHappened,
    possibleCauses: entry.causes || [],
    whatYouCanDo: extra.actions || entry.actions || [],
    retryStatus: extra.retry || entry.retry,
    retryNote: entry.retryNote || extra.retryNote || null,
    retryAfter: extra.retryAfter || null,
    correlationId: extra.correlationId || null,
    detail: extra.detail || null,
    technical: extra.technical || null,
    testStopped: extra.testStopped ?? null,
    laterStagesSkipped: extra.laterStagesSkipped ?? null,
    time: ukTime(now),
    timeIso: now.toISOString()
  };
}

function list() {
  return Object.entries(CATALOGUE).map(([code, e]) => ({
    code, status: e.status, title: e.title, whatHappened: e.what,
    whatThisMeans: e.means, whatHasNotHappened: e.notHappened,
    possibleCauses: e.causes || [], whatYouCanDo: e.actions || [], retryStatus: e.retry
  }));
}

module.exports = { build, list, RETRY, ukTime, CATALOGUE };
