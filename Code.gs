/**
 * ============================================================================
 * GOOGLE WORKSPACE ORGANIZATION & MULTI-DOMAIN USAGE REPORT (ADOPTION SCORECARD)
 * ============================================================================
 *
 * Generates a comprehensive Google Workspace Adoption Scorecard and Multi-Domain
 * Usage Report in Google Sheets for a Google Workspace Super Admin.
 *
 * Key Capabilities:
 * 1. Multi-Domain Discovery:
 *    - Queries AdminDirectory.Customers.get('my_customer'),
 *      AdminDirectory.Domains.list('my_customer'), and
 *      AdminDirectory.DomainAliases.list('my_customer') to discover ALL
 *      domains in the Google Workspace organization (not just the admin's
 *      email domain).
 *    - Queries AdminDirectory.Users.list({ customer: 'my_customer' }) to
 *      inventory users across every domain in the tenant.
 *
 * 2. Rigorous 28-Day Product Adoption (Counts & Percentages):
 *    - Combines CustomerUsageReports, UserUsageReport, and Activity Audit
 *      Reports (Activities.list) over a 28-day rolling computation window
 *      anchored to the latest available report date in PST (America/Los_Angeles).
 *    - Accurately retrieves adoption for all 9 Scorecard products:
 *      Gmail, Calendar, Drive, Docs, Sheets, Slides, Chat, Meet, and Contacts,
 *      plus overall Google Workspace active users (WORKSPACE_ALL).
 *    - Reports both numbers (active user counts) and percentages:
 *      (a) % of Active Workspace Users (matching the Google Workspace Adoption
 *          Scorecard methodology), and
 *      (b) % of Total Users / Purchased Licenses & % of Active Provisioned Users.
 *
 * 3. Complete 28-Day Google Meet Usage Analytics:
 *    - Aggregates both daily CustomerUsageReports (meet:num_meetings,
 *      meet:total_meeting_minutes, meet:average_meeting_minutes) and conference-
 *      level Meet Audit logs (Activities.list for applicationName='meet')
 *      grouped by conference_id (filtering out 1-participant lonely meetings)
 *      to compute:
 *      - Total meetings in the past 28 days
 *      - Average meeting duration in minutes in the past 28 days
 *      - Meetings with screen sharing (count & % of meetings)
 *      - Meetings recorded (count & % of meetings)
 *      - Meetings live streamed (count & % of meetings)
 *      - Meetings with >100 participants (count & % of meetings)
 *
 * 4. Visual Scorecard + Multi-Domain Breakdown Formatting:
 *    - Builds an executive "Adoption Scorecard" sheet modeled after the official
 *      Google Workspace Adoption Scorecard PDF, followed by a full numerical &
 *      percentage table.
 *    - Builds a "Multi-Domain Breakdown" sheet showing user inventory, per-product
 *      adoption (counts & percentages), and Meet usage for every domain.
 *    - Optionally generates individual visual Scorecard tabs for each domain.
 */

const REPORT_CONFIG = {
  COMPUTATION_WINDOW_DAYS: 28,
  REPORT_TIMEZONE: 'America/Los_Angeles', // Admin SDK Reports API uses PST boundaries
  MAX_LOOKBACK_DAYS_FOR_REPORT_DATE: 10,
  INITIAL_LAG_DAYS: 2,
  MAX_AUDIT_PAGES_PER_APP: 25, // Memory-safe page cap (up to 25,000 events per app with maxResults=1000)
  MAX_AUDIT_PAGES_BY_APP: {
    meet: 35,
    drive: 20,
    calendar: 20,
    contacts: 15,
    token: 15,
    chat: 10,
    login: 5
  },
  AUDIT_MAX_RESULTS: 1000,
  USER_USAGE_MAX_RESULTS: 1000,
  DIRECTORY_USERS_MAX_RESULTS: 500,
  RETRY_MAX_ATTEMPTS: 4,
  RETRY_INITIAL_DELAY_MS: 1000,
  SHEET_NAMES: {
    SCORECARD: 'Adoption Scorecard',
    DOMAIN_BREAKDOWN: 'Multi-Domain Breakdown',
    METHODOLOGY: 'Data Sources & Audit Log',
    MEET_DEEP_DIVE: 'Meet Usage Deep-Dive'
  },
  COLORS: {
    GOOGLE_BLUE: '#4285F4',
    GOOGLE_RED: '#EA4335',
    GOOGLE_YELLOW: '#FBBC05',
    GOOGLE_GREEN: '#34A853',
    SCORECARD_BANNER_YELLOW: '#FDD663',
    HERO_BLUE: '#0B57D0',
    HERO_DARK_GREY: '#444746',
    PROGRESS_FILL_BLUE: '#7CACF8',
    PROGRESS_BG_GREY: '#E3E3E3',
    DATE_ALERT_RED: '#D93025',
    SECTION_HEADER_GREY: '#5E5E5E',
    STRIPE_RED: '#C5221F',
    STRIPE_YELLOW: '#F29900',
    STRIPE_BLUE: '#1967D2',
    STRIPE_GREEN: '#188038',
    CARD_GREY_BG: '#F1F1F1',
    CARD_WHITE_BG: '#FFFFFF',
    TEXT_PRIMARY: '#202124',
    TEXT_SECONDARY: '#3C4043',
    TEXT_MUTED: '#5F6368',
    TABLE_HEADER_BG: '#1A73E8',
    TABLE_SUBHEADER_BG: '#E8F0FE',
    BORDER_DARK: '#000000',
    BORDER_LIGHT: '#DADCE0'
  }
};

/**
 * Product definitions matching the Google Workspace Adoption Scorecard.
 * Note: In Admin SDK Reports API, Docs/Sheets/Slides customer & user usage
 * parameters live under the `drive:` namespace (`drive:num_30day_google_documents_active_users`,
 * etc.) because the legacy `docs:` report namespace was deprecated in May 2018.
 */
const WORKSPACE_PRODUCTS = [
  {
    key: 'GMAIL',
    label: 'Gmail',
    iconBadge: '✉️ Gmail',
    badgeColor: '#EA4335',
    customerParam30d: 'gmail:num_30day_active_users',
    customerParam7d: 'gmail:num_7day_active_users',
    customerParam1d: 'gmail:num_1day_active_users',
    description: 'Active users who have used Gmail in the past 28 days'
  },
  {
    key: 'CALENDAR',
    label: 'Calendar',
    iconBadge: '📅 Calendar',
    badgeColor: '#1967D2',
    customerParam30d: 'calendar:num_30day_active_users',
    customerParam7d: 'calendar:num_7day_active_users',
    customerParam1d: 'calendar:num_1day_active_users',
    description: 'Active users who have used Calendar in the past 28 days'
  },
  {
    key: 'DRIVE',
    label: 'Drive',
    iconBadge: '📁 Drive',
    badgeColor: '#188038',
    customerParam30d: 'drive:num_30day_active_users',
    customerParam7d: 'drive:num_7day_active_users',
    customerParam1d: 'drive:num_1day_active_users',
    description: 'Active users who have used Drive in the past 28 days'
  },
  {
    key: 'DOCS',
    label: 'Docs',
    iconBadge: '📄 Docs',
    badgeColor: '#4285F4',
    customerParam30d: 'drive:num_30day_google_documents_active_users',
    customerParam7d: 'drive:num_7day_google_documents_active_users',
    customerParam1d: 'drive:num_1day_google_documents_active_users',
    description: 'Active users who have used Docs in the past 28 days'
  },
  {
    key: 'SHEETS',
    label: 'Sheets',
    iconBadge: '📊 Sheets',
    badgeColor: '#188038',
    customerParam30d: 'drive:num_30day_google_spreadsheets_active_users',
    customerParam7d: 'drive:num_7day_google_spreadsheets_active_users',
    customerParam1d: 'drive:num_1day_google_spreadsheets_active_users',
    description: 'Active users who have used Sheets in the past 28 days'
  },
  {
    key: 'SLIDES',
    label: 'Slides',
    iconBadge: '📽️ Slides',
    badgeColor: '#F29900',
    customerParam30d: 'drive:num_30day_google_presentations_active_users',
    customerParam7d: 'drive:num_7day_google_presentations_active_users',
    customerParam1d: 'drive:num_1day_google_presentations_active_users',
    description: 'Active users who have used Slides in the past 28 days'
  },
  {
    key: 'CHAT',
    label: 'Chat',
    iconBadge: '💬 Chat',
    badgeColor: '#188038',
    customerParam28d: 'chat:num_28day_engaged_users',
    customerParam30d: 'chat:num_28day_engaged_users',
    customerParam7d: 'chat:num_7day_engaged_users',
    customerParam1d: 'chat:num_1day_engaged_users',
    description: 'Active users who have used Chat in the past 28 days'
  },
  {
    key: 'MEET',
    label: 'Meet',
    iconBadge: '🎥 Meet',
    badgeColor: '#00897B',
    customerParam30d: 'meet:num_30day_active_users',
    customerParam7d: 'meet:num_7day_active_users',
    customerParam1d: 'meet:num_1day_active_users',
    description: 'Active users who have used Meet in the past 28 days'
  },
  {
    key: 'CONTACTS',
    label: 'Contacts',
    iconBadge: '👤 Contacts',
    badgeColor: '#1967D2',
    customerParam30d: null, // Derived via Contacts & Token Audit + Directory activity
    customerParam7d: null,
    customerParam1d: null,
    description: 'Active users who have used Contacts in the past 28 days'
  }
];

/**
 * Compact bitmask flags for per-user product activity deduplication.
 * Eliminates large in-memory Set allocations per user/domain.
 */
const PRODUCT_BITS = {
  GMAIL: 1 << 0,      // 1
  CALENDAR: 1 << 1,   // 2
  DRIVE: 1 << 2,      // 4
  DOCS: 1 << 3,       // 8
  SHEETS: 1 << 4,     // 16
  SLIDES: 1 << 5,     // 32
  CHAT: 1 << 6,       // 64
  MEET: 1 << 7,       // 128
  CONTACTS: 1 << 8    // 256
};
const WORKSPACE_ACTIVE_BIT = 1 << 9; // 512

/**
 * Adds a custom menu when the Google Sheet is opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏢 Workspace Usage Report')
    .addItem('▶️ Generate Core Workspace Usage Report (Fast Overview)', 'generateWorkspaceUsageReport')
    .addItem('📹 Generate Granular Meet Usage Report', 'generateGranularMeetUsageReport')
    .addSeparator()
    .addItem('🔄 Generate Complete Report (Core Services + Granular Meet)', 'generateCompleteWorkspaceUsageReport')
    .addItem('🌐 Generate Individual Scorecard Tabs Per Domain', 'generateWorkspaceUsageReportWithDomainTabs')
    .addToUi();
}

/**
 * Main entry point for Super Admins: retrieves core usage across ALL domains in the
 * Google Workspace organization and renders the executive Adoption Scorecard & Breakdown.
 * Skips the heavy 28-day daily Meet rollup and conference audit loops for maximum speed.
 */
function generateWorkspaceUsageReport() {
  return runWorkspaceUsageReport_({
    createPerDomainScorecardTabs: false,
    includeMeetGranularAudit: false
  });
}

/**
 * Dedicated entry point for deep-dive Google Meet telemetry:
 * Analyzes 28-day conference audit logs, screen sharing, recording, livestreams,
 * large meetings (>100 participants), and multi-domain conference metrics.
 * Renders the dedicated 'Meet Usage Deep-Dive' sheet and updates existing scorecard cards.
 */
function generateGranularMeetUsageReport() {
  return runGranularMeetReport_();
}

/**
 * Generates the complete report including core service overview AND granular Meet conference telemetry in a single run.
 */
function generateCompleteWorkspaceUsageReport() {
  return runWorkspaceUsageReport_({
    createPerDomainScorecardTabs: false,
    includeMeetGranularAudit: true
  });
}

/**
 * Entry point that also creates a dedicated visual Scorecard tab for each
 * individual domain in the organization.
 */
function generateWorkspaceUsageReportWithDomainTabs() {
  return runWorkspaceUsageReport_({
    createPerDomainScorecardTabs: true,
    includeMeetGranularAudit: false
  });
}

/**
 * Core orchestrator for fetching, reconciling, and rendering the report.
 * @param {{createPerDomainScorecardTabs: boolean, includeMeetGranularAudit: boolean}} options
 */
function runWorkspaceUsageReport_(options) {
  const opts = options || {
    createPerDomainScorecardTabs: false,
    includeMeetGranularAudit: false
  };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  toast_(ss, 'Step 1/6: Discovering organization customer ID and all registered domains...', 'Workspace Usage Report');

  // 1. Discover Customer ID and ALL Domains (primary, secondary, and aliases)
  const orgInfo = discoverOrganizationAndDomains_();

  // 2. Find latest available CustomerUsageReports date and compute 28-day window
  toast_(ss, 'Step 2/6: Determining latest available Admin Reports date (28-day window)...', 'Workspace Usage Report');
  const windowInfo = findLatestAvailableReportDate_();

  // 3. Fetch all users across all domains from Directory API
  toast_(ss, 'Step 3/6: Listing users across all domains via Admin Directory API...', 'Workspace Usage Report');
  const directoryData = fetchUserAndLicenseInventory_(orgInfo, windowInfo);

  // 4. Fetch CustomerUsageReports (latest snapshot + optional 28-day daily Meet rollup)
  toast_(ss, 'Step 4/6: Fetching Customer Usage Reports & product metrics...', 'Workspace Usage Report');
  const customerUsage = fetchCustomerUsageMetrics_(windowInfo, orgInfo, directoryData, opts);

  // 5. Fetch per-user usage report & 28-day Activity Audit logs across apps
  toast_(ss, 'Step 5/6: Fetching User Usage & 28-day Activity Audit logs across all products...', 'Workspace Usage Report');
  const userAndAuditUsage = fetchUserAndActivityAuditMetrics_(
    windowInfo,
    orgInfo,
    directoryData,
    customerUsage,
    opts
  );

  // 6. Reconcile organization-wide and per-domain numbers & percentages
  const reportModel = buildReconciledReportModel_(
    orgInfo,
    windowInfo,
    directoryData,
    customerUsage,
    userAndAuditUsage
  );

  // 7. Render well-formatted sheets
  toast_(ss, 'Step 6/6: Formatting Adoption Scorecard & Multi-Domain Breakdown sheets...', 'Workspace Usage Report');
  renderAllReportSheets_(ss, reportModel, opts);

  toast_(ss, 'Google Workspace Adoption Scorecard & Multi-Domain Report completed!', 'Complete', 8);
  return reportModel;
}

/**
 * ============================================================================
 * STEP 1: MULTI-DOMAIN & CUSTOMER DISCOVERY
 * ============================================================================
 * Retrieves the organization's Customer ID, primary domain, all secondary
 * domains, and domain aliases using AdminDirectory. Does NOT rely solely on
 * the admin's email address domain.
 */
function discoverOrganizationAndDomains_() {
  let adminEmail = '';
  try {
    adminEmail = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  } catch (e) {
    Logger.log('Could not read Session.getActiveUser().getEmail(): ' + e.message);
  }

  let customerId = 'my_customer';
  let primaryDomain = '';
  let orgDisplayName = '';

  // 1A. Query Customers.get('my_customer')
  try {
    const customer = executeWithRetry_(() => AdminDirectory.Customers.get('my_customer'));
    if (customer) {
      customerId = customer.id || 'my_customer';
      primaryDomain = (customer.customerDomain || '').toLowerCase().trim();
      orgDisplayName =
        (customer.postalAddress && customer.postalAddress.organizationName) ||
        primaryDomain ||
        'Google Workspace Organization';
    }
  } catch (e) {
    Logger.log('AdminDirectory.Customers.get("my_customer") fallback: ' + e.message);
    if (adminEmail) {
      try {
        const adminUser = executeWithRetry_(() => AdminDirectory.Users.get(adminEmail));
        if (adminUser && adminUser.customerId) {
          customerId = adminUser.customerId;
        }
      } catch (innerErr) {
        Logger.log('AdminDirectory.Users.get(adminEmail) fallback: ' + innerErr.message);
      }
    }
  }

  // 1B. Query Domains.list to retrieve ALL domains in the Google Workspace tenant
  const domainsMap = new Map();
  try {
    const domainsResp = executeWithRetry_(() => AdminDirectory.Domains.list(customerId));
    const domainItems = (domainsResp && domainsResp.domains) || [];
    domainItems.forEach((d) => {
      const name = (d.domainName || '').toLowerCase().trim();
      if (!name) return;
      if (d.isPrimary && !primaryDomain) {
        primaryDomain = name;
      }
      domainsMap.set(name, {
        domainName: name,
        isPrimary: Boolean(d.isPrimary),
        verified: Boolean(d.verified),
        domainType: d.isPrimary ? 'Primary Domain' : 'Secondary Domain',
        creationTime: d.creationTime || null,
        aliases: []
      });
    });
  } catch (e) {
    Logger.log('AdminDirectory.Domains.list warning: ' + e.message);
  }

  // 1C. Query DomainAliases.list to capture all domain aliases
  const aliasToParentDomain = new Map();
  try {
    const aliasResp = executeWithRetry_(() => AdminDirectory.DomainAliases.list(customerId));
    const aliasItems = (aliasResp && aliasResp.domainAliases) || [];
    aliasItems.forEach((a) => {
      const aliasName = (a.domainAliasName || '').toLowerCase().trim();
      const parentName = (a.parentDomainName || primaryDomain || '').toLowerCase().trim();
      if (!aliasName) return;
      aliasToParentDomain.set(aliasName, parentName);
      if (domainsMap.has(parentName)) {
        domainsMap.get(parentName).aliases.push(aliasName);
      }
      if (!domainsMap.has(aliasName)) {
        domainsMap.set(aliasName, {
          domainName: aliasName,
          isPrimary: false,
          verified: Boolean(a.verified),
          domainType: parentName ? `Domain Alias (→ ${parentName})` : 'Domain Alias',
          creationTime: a.creationTime || null,
          isAlias: true,
          parentDomainName: parentName,
          aliases: []
        });
      }
    });
  } catch (e) {
    Logger.log('AdminDirectory.DomainAliases.list warning: ' + e.message);
  }

  // Ensure admin's domain or primaryDomain is present if Domains.list was restricted
  if (!primaryDomain && adminEmail.includes('@')) {
    primaryDomain = adminEmail.split('@')[1];
  }
  if (primaryDomain && !domainsMap.has(primaryDomain)) {
    domainsMap.set(primaryDomain, {
      domainName: primaryDomain,
      isPrimary: true,
      verified: true,
      domainType: 'Primary Domain',
      creationTime: null,
      aliases: []
    });
  }

  return {
    customerId: customerId,
    primaryDomain: primaryDomain || 'workspace-organization.com',
    orgDisplayName: orgDisplayName || primaryDomain || 'Google Workspace Organization',
    adminEmail: adminEmail,
    domainsMap: domainsMap,
    aliasToParentDomain: aliasToParentDomain
  };
}

/**
 * ============================================================================
 * STEP 2: DETERMINE LATEST AVAILABLE REPORT DATE & 28-DAY WINDOW
 * ============================================================================
 * Admin SDK Usage Reports lag by ~2-4 days. We walk backwards from 2 days ago
 * until we find a date where CustomerUsageReports returns populated metrics
 * across core services (accounts, gmail, calendar, drive, meet, chat).
 */
function findLatestAvailableReportDate_() {
  const tz = REPORT_CONFIG.REPORT_TIMEZONE;
  const now = new Date();
  let chosenDateObj = null;
  let chosenDateStr = null;
  let chosenReportParams = null;
  let fallbackDateObj = null;
  let fallbackDateStr = null;
  let fallbackReportParams = null;

  for (
    let daysBack = REPORT_CONFIG.INITIAL_LAG_DAYS;
    daysBack <= REPORT_CONFIG.MAX_LOOKBACK_DAYS_FOR_REPORT_DATE;
    daysBack++
  ) {
    const candidateDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const candidateStr = Utilities.formatDate(candidateDate, tz, 'yyyy-MM-dd');
    try {
      const resp = executeWithRetry_(() =>
        AdminReports.CustomerUsageReports.get(candidateStr)
      );
      if (resp && resp.usageReports && resp.usageReports.length > 0) {
        const paramsList = resp.usageReports[0].parameters || [];
        const paramMap = parseReportParametersList_(paramsList);

        // Record first non-empty report as fallback
        if (!fallbackDateStr && Object.keys(paramMap).length > 0) {
          fallbackDateObj = candidateDate;
          fallbackDateStr = candidateStr;
          fallbackReportParams = paramMap;
        }

        // Verify core application metrics are populated on this date
        const hasAccounts =
          paramMap['accounts:num_users'] !== undefined ||
          paramMap['accounts:num_30day_logins'] !== undefined;
        const hasGmail = paramMap['gmail:num_30day_active_users'] !== undefined;
        const hasDrive = paramMap['drive:num_30day_active_users'] !== undefined;
        const hasCalendar = paramMap['calendar:num_30day_active_users'] !== undefined;

        if (hasAccounts && (hasGmail || hasDrive || hasCalendar)) {
          chosenDateObj = candidateDate;
          chosenDateStr = candidateStr;
          chosenReportParams = paramMap;
          break;
        }
      }
    } catch (e) {
      // If API exception specifies "Data for dates later than YYYY-MM-DD is not yet available",
      // extract that date directly.
      const msg = String(e && e.message ? e.message : e);
      const match = msg.match(/(\d{4}-\d{2}-\d{2})/);
      if (match && match[1] && match[1] < candidateStr) {
        try {
          const hintedStr = match[1];
          const hintedResp = executeWithRetry_(() =>
            AdminReports.CustomerUsageReports.get(hintedStr)
          );
          if (hintedResp && hintedResp.usageReports && hintedResp.usageReports.length > 0) {
            chosenDateStr = hintedStr;
            chosenDateObj = parseIsoDateInTz_(hintedStr);
            chosenReportParams = parseReportParametersList_(
              hintedResp.usageReports[0].parameters || []
            );
            break;
          }
        } catch (innerErr) {
          Logger.log('Hinted date lookup failed: ' + innerErr.message);
        }
      }
    }
  }

  if (!chosenDateStr) {
    if (fallbackDateStr) {
      chosenDateObj = fallbackDateObj;
      chosenDateStr = fallbackDateStr;
      chosenReportParams = fallbackReportParams;
    } else {
      // Default to 3 days ago if no CustomerUsageReports exist yet
      chosenDateObj = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      chosenDateStr = Utilities.formatDate(chosenDateObj, tz, 'yyyy-MM-dd');
      chosenReportParams = {};
    }
  }

  // Computation window is 28 days inclusive of reportDate: [reportDate - 27 days, reportDate]
  const windowDays = REPORT_CONFIG.COMPUTATION_WINDOW_DAYS;
  const endDateStr = chosenDateStr;
  const endDateObj = parseIsoDateInTz_(endDateStr);
  const startDateObj = new Date(endDateObj.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000);
  const startDateStr = Utilities.formatDate(startDateObj, tz, 'yyyy-MM-dd');

  const dailyDateStrings = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(endDateObj.getTime() - i * 24 * 60 * 60 * 1000);
    dailyDateStrings.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
  }

  const startIsoUtc = `${startDateStr}T00:00:00.000Z`;
  const endIsoUtc = `${endDateStr}T23:59:59.999Z`;

  return {
    reportDateStr: endDateStr,
    reportDateFormatted: Utilities.formatDate(endDateObj, tz, 'MMM d, yyyy'),
    windowStartDateStr: startDateStr,
    windowEndDateStr: endDateStr,
    windowStartMs: new Date(startIsoUtc).getTime(),
    windowEndMs: new Date(endIsoUtc).getTime(),
    windowStartIso: startIsoUtc,
    windowEndIso: endIsoUtc,
    computationWindowDays: windowDays,
    dailyDateStrings: dailyDateStrings,
    initialCustomerParams: chosenReportParams
  };
}

/**
 * ============================================================================
 * STEP 3: DIRECTORY USER & LICENSE INVENTORY ACROSS ALL DOMAINS
 * ============================================================================
 * Queries AdminDirectory.Users.list({ customer: customerId }) so that users
 * from ALL domains (primary, secondary, subdomains) are retrieved.
 */
function fetchUserAndLicenseInventory_(orgInfo, windowInfo) {
  const domainStatsMap = new Map();
  const userMaskMap = new Map();
  let totalUsersCount = 0;

  // Initialize domain stats for all discovered domains
  orgInfo.domainsMap.forEach((domainMeta, domainName) => {
    domainStatsMap.set(domainName, createEmptyDomainStats_(domainName, domainMeta));
  });

  let pageToken = null;
  let useFields = true;

  do {
    const listArgs = {
      customer: orgInfo.customerId || 'my_customer',
      maxResults: REPORT_CONFIG.DIRECTORY_USERS_MAX_RESULTS,
      showDeleted: 'false'
    };
    if (useFields) {
      listArgs.projection = 'BASIC';
      listArgs.fields = 'nextPageToken,users(primaryEmail,suspended,archived,lastLoginTime,aliases)';
    }
    if (pageToken) {
      listArgs.pageToken = pageToken;
    }

    let resp = null;
    try {
      resp = executeWithRetry_(() => AdminDirectory.Users.list(listArgs));
    } catch (e) {
      if (useFields && !pageToken) {
        // Fallback: retry without partial fields projection
        useFields = false;
        delete listArgs.projection;
        delete listArgs.fields;
        try {
          resp = executeWithRetry_(() => AdminDirectory.Users.list(listArgs));
        } catch (innerE) {
          if (listArgs.customer !== 'my_customer') {
            listArgs.customer = 'my_customer';
            resp = executeWithRetry_(() => AdminDirectory.Users.list(listArgs));
          } else {
            throw innerE;
          }
        }
      } else if (listArgs.customer !== 'my_customer') {
        listArgs.customer = 'my_customer';
        resp = executeWithRetry_(() => AdminDirectory.Users.list(listArgs));
      } else {
        throw e;
      }
    }

    const users = (resp && resp.users) || [];
    for (let uIdx = 0; uIdx < users.length; uIdx++) {
      const u = users[uIdx];
      const email = (u.primaryEmail || '').toLowerCase().trim();
      if (!email || !email.includes('@')) continue;

      totalUsersCount++;
      let domain = email.split('@')[1];
      if (orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(domain)) {
        domain = orgInfo.aliasToParentDomain.get(domain);
      }

      if (!domainStatsMap.has(domain)) {
        const discoveredMeta = {
          domainName: domain,
          isPrimary: domain === orgInfo.primaryDomain,
          verified: true,
          domainType: domain === orgInfo.primaryDomain ? 'Primary Domain' : 'Secondary / Subdomain',
          creationTime: null,
          aliases: []
        };
        orgInfo.domainsMap.set(domain, discoveredMeta);
        domainStatsMap.set(domain, createEmptyDomainStats_(domain, discoveredMeta));
      }

      const isSuspended = Boolean(u.suspended);
      const isArchived = Boolean(u.archived);
      const lastLoginMs = parseTimestampToMs_(u.lastLoginTime);
      const loggedIn28d =
        lastLoginMs !== null &&
        lastLoginMs >= windowInfo.windowStartMs &&
        lastLoginMs <= windowInfo.windowEndMs;

      // Accumulate domain-level user counts directly
      const dStats = domainStatsMap.get(domain);
      dStats.totalUsers++;
      if (isSuspended) {
        dStats.suspendedUsers++;
      } else if (isArchived) {
        dStats.archivedUsers++;
      } else {
        dStats.activeProvisionedUsers++;
      }
      if (loggedIn28d) {
        userMaskMap.set(email, WORKSPACE_ACTIVE_BIT);
        dStats.directWorkspaceActiveCount++;
      }

      // Map user aliases as well so audit events using an alias resolve to primaryEmail
      if (Array.isArray(u.aliases) && u.aliases.length > 0) {
        u.aliases.forEach((aliasEmail) => {
          const normAlias = (aliasEmail || '').toLowerCase().trim();
          if (normAlias) {
            dStats.aliasEmailToPrimary.set(normAlias, email);
          }
        });
      }
    }

    pageToken = resp ? resp.nextPageToken : null;
  } while (pageToken);

  return {
    totalUsers: totalUsersCount,
    domainStatsMap: domainStatsMap,
    userMaskMap: userMaskMap,
    usersByEmail: {
      get size() {
        return totalUsersCount;
      },
      has: function(email) {
        if (!email || !email.includes('@')) return false;
        let dom = email.split('@')[1];
        if (orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(dom)) {
          dom = orgInfo.aliasToParentDomain.get(dom);
        }
        return domainStatsMap.has(dom);
      }
    }
  };
}

/**
 * Creates an empty per-domain aggregation record with lightweight numeric counters
 * and memory-safe backward compatibility proxies.
 */
function createEmptyDomainStats_(domainName, domainMeta) {
  const productCounts = {};
  const productProxy = {};
  WORKSPACE_PRODUCTS.forEach((p) => {
    productCounts[p.key] = 0;
    productProxy[p.key] = {
      get size() {
        return productCounts[p.key] || 0;
      },
      add: function() {}
    };
  });
  return {
    domainName: domainName,
    domainMeta: domainMeta || {
      domainName: domainName,
      isPrimary: false,
      verified: true,
      domainType: 'Secondary Domain',
      aliases: []
    },
    totalUsers: 0,
    activeProvisionedUsers: 0,
    suspendedUsers: 0,
    archivedUsers: 0,
    storageUsedMb: 0,
    directWorkspaceActiveCount: 0,
    productCounts: productCounts,
    aliasEmailToPrimary: new Map(),
    meetConferencesMap: new Map(),
    meetSummary: null,
    get activeWorkspaceUsersSet() {
      const self = this;
      return {
        get size() {
          return self.directWorkspaceActiveCount;
        },
        add: function() {}
      };
    },
    productActiveUsersSets: productProxy
  };
}

/**
 * ============================================================================
 * STEP 4: CUSTOMER USAGE REPORTS & 28-DAY DAILY MEET AGGREGATION
 * ============================================================================
 * Extracts organization-wide license counts, product active user counts, and
 * 28-day daily Google Meet call/meeting totals from CustomerUsageReports.
 */
function fetchCustomerUsageMetrics_(windowInfo, orgInfo, directoryData, options) {
  const params = windowInfo.initialCustomerParams || {};

  // 4A. Calculate total purchased & assigned licenses from CustomerUsageReports
  // Note: In accounts parameters, `apps_total_licenses` and `gsuite_basic_total_licenses`
  // both represent G Suite Basic total licenses; avoid double-counting them.
  let basicTotal = Math.max(
    toInt_(params['accounts:gsuite_basic_total_licenses']),
    toInt_(params['accounts:apps_total_licenses'])
  );
  let basicUsed = Math.max(
    toInt_(params['accounts:gsuite_basic_used_licenses']),
    toInt_(params['accounts:apps_used_licenses'])
  );
  let enterpriseTotal = toInt_(params['accounts:gsuite_enterprise_total_licenses']);
  let enterpriseUsed = toInt_(params['accounts:gsuite_enterprise_used_licenses']);
  let unlimitedTotal = toInt_(params['accounts:gsuite_unlimited_total_licenses']);
  let unlimitedUsed = toInt_(params['accounts:gsuite_unlimited_used_licenses']);

  // Also inspect any other `accounts:*_total_licenses` returned dynamically
  const handledLicenseKeys = new Set([
    'accounts:gsuite_basic_total_licenses',
    'accounts:apps_total_licenses',
    'accounts:gsuite_enterprise_total_licenses',
    'accounts:gsuite_unlimited_total_licenses',
    'accounts:coordinate_total_licenses',
    'accounts:vault_total_licenses'
  ]);
  let additionalWorkspaceTotal = 0;
  let additionalWorkspaceUsed = 0;
  Object.keys(params).forEach((k) => {
    if (k.startsWith('accounts:') && k.endsWith('_total_licenses') && !handledLicenseKeys.has(k)) {
      additionalWorkspaceTotal += toInt_(params[k]);
      const usedKey = k.replace('_total_licenses', '_used_licenses');
      additionalWorkspaceUsed += toInt_(params[usedKey]);
    }
  });

  let reportTotalLicenses =
    basicTotal + enterpriseTotal + unlimitedTotal + additionalWorkspaceTotal;
  let reportUsedLicenses =
    basicUsed + enterpriseUsed + unlimitedUsed + additionalWorkspaceUsed;

  const accountsNumUsers = toInt_(params['accounts:num_users']);
  const directoryTotalUsers = directoryData.usersByEmail.size;

  // Optional check via AdminLicenseManager if reportTotalLicenses == 0
  let licenseManagerAssignedCount = 0;
  if (reportTotalLicenses === 0 && typeof AdminLicenseManager !== 'undefined') {
    licenseManagerAssignedCount = tryCountAssignedWorkspaceLicenses_(orgInfo.customerId);
  }

  // Total Users (Scorecard definition: "Number of licenses purchased from Google.
  // May not necessarily be the number of licenses deployed.")
  const totalPurchasedLicenses =
    reportTotalLicenses > 0
      ? reportTotalLicenses
      : licenseManagerAssignedCount > 0
      ? Math.max(licenseManagerAssignedCount, directoryTotalUsers)
      : Math.max(accountsNumUsers, directoryTotalUsers);

  const totalAssignedLicenses =
    reportUsedLicenses > 0
      ? reportUsedLicenses
      : licenseManagerAssignedCount > 0
      ? licenseManagerAssignedCount
      : directoryTotalUsers;

  // 4B. Extract 1-day, 7-day, 28-day, and 30-day active user counters per product
  const productCustomerCounts = {};
  WORKSPACE_PRODUCTS.forEach((p) => {
    let count1d = p.customerParam1d ? toInt_(params[p.customerParam1d]) : 0;
    let count7d = p.customerParam7d ? toInt_(params[p.customerParam7d]) : 0;
    let count30d = p.customerParam30d ? toInt_(params[p.customerParam30d]) : 0;
    let count28dNative = p.customerParam28d ? toInt_(params[p.customerParam28d]) : null;

    // Resilient fallback check for Google Meet parameter variations across API versions
    if (p.key === 'MEET') {
      if (count30d === 0) {
        count30d = toInt_(params['meet:num_30day_active_users']) ||
                   toInt_(params['meet:num_30day_users']) ||
                   toInt_(params['meet:num_active_users']) ||
                   toInt_(params['meet:num_users']) || 0;
      }
      if (count7d === 0) {
        count7d = toInt_(params['meet:num_7day_active_users']) ||
                  toInt_(params['meet:num_7day_users']) || 0;
      }
      if (count1d === 0) {
        count1d = toInt_(params['meet:num_1day_active_users']) ||
                  toInt_(params['meet:num_1day_users']) || 0;
      }
    }

    // When a product reports 7-day and 30-day rolling active users in CustomerUsageReports
    // (e.g., Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet), interpolate the 28-day
    // rolling window value between 7d and 30d: 7d + (21/23)*(30d - 7d), bounded by [7d, 30d].
    let estimated28dFromCustomerReport = 0;
    if (count28dNative !== null && count28dNative > 0) {
      estimated28dFromCustomerReport = count28dNative;
    } else if (count30d > 0) {
      if (count7d > 0 && count30d >= count7d) {
        estimated28dFromCustomerReport = Math.round(
          count7d + ((28 - 7) / (30 - 7)) * (count30d - count7d)
        );
      } else {
        estimated28dFromCustomerReport = count30d;
      }
    }

    productCustomerCounts[p.key] = {
      count1d: count1d,
      count7d: count7d,
      count30d: count30d,
      count28dCustomer: estimated28dFromCustomerReport
    };
  });

  // Overall Workspace logins from CustomerUsageReports
  const logins1d = toInt_(params['accounts:num_1day_logins']);
  const logins7d = toInt_(params['accounts:num_7day_logins']);
  const logins30d = toInt_(params['accounts:num_30day_logins']);
  const logins28dEstimated =
    logins30d >= logins7d && logins7d > 0
      ? Math.round(logins7d + ((28 - 7) / (30 - 7)) * (logins30d - logins7d))
      : logins30d;

  // 4C. Aggregate daily Meet metrics from CustomerUsageReports across the 28-day window
  let dailyMeetRollup = null;
  if (options && options.includeMeetGranularAudit) {
    dailyMeetRollup = fetch28DayDailyMeetCustomerUsage_(windowInfo);
  } else {
    // Fast path: extract baseline totals directly from initialCustomerParams without 28 daily API calls
    const snapshotMeetings = toInt_(params['meet:num_meetings']);
    const snapshotTotalMins = toInt_(params['meet:total_meeting_minutes']);
    const snapshotAvgMins = toInt_(params['meet:average_meeting_minutes']);
    const snapshotCalls = toInt_(params['meet:num_calls']);
    const snapshotCallMins = toInt_(params['meet:total_call_minutes']);
    dailyMeetRollup = {
      totalMeetings28d: snapshotMeetings,
      totalMeetingMinutes28d: snapshotTotalMins,
      avgMeetingMinutes28d: snapshotAvgMins,
      totalCalls28d: snapshotCalls,
      totalCallMinutes28d: snapshotCallMins,
      isBaselineOnly: true
    };
  }

  return {
    rawParams: params,
    totalPurchasedLicenses: totalPurchasedLicenses,
    totalAssignedLicenses: totalAssignedLicenses,
    accountsNumUsers: Math.max(accountsNumUsers, directoryTotalUsers),
    accountsSuspendedUsers: toInt_(params['accounts:num_suspended_users']),
    accountsArchivedUsers: toInt_(params['accounts:num_archived_users']),
    customerUsedQuotaMb:
      toInt_(params['accounts:customer_used_quota_in_mb']) ||
      toInt_(params['accounts:used_quota_in_mb']),
    driveUsedQuotaMb: toInt_(params['accounts:drive_used_quota_in_mb']),
    gmailUsedQuotaMb: toInt_(params['accounts:gmail_used_quota_in_mb']),
    logins1d: logins1d,
    logins7d: logins7d,
    logins30d: logins30d,
    logins28dEstimated: logins28dEstimated,
    productCustomerCounts: productCustomerCounts,
    dailyMeetRollup: dailyMeetRollup
  };
}

/**
 * Fetches daily Meet CustomerUsageReports parameters across the 28-day window
 * (`meet:num_meetings`, `meet:total_meeting_minutes`, `meet:average_meeting_minutes`,
 * `meet:num_calls`, `meet:total_call_minutes`, `meet:lonely_meetings`).
 */
function fetch28DayDailyMeetCustomerUsage_(windowInfo) {
  const meetParamsQuery = [
    'meet:num_meetings',
    'meet:total_meeting_minutes',
    'meet:average_meeting_minutes',
    'meet:num_calls',
    'meet:total_call_minutes',
    'meet:lonely_meetings',
    'meet:num_meetings_with_external_users'
  ].join(',');

  let totalMeetings28d = 0;
  let totalMeetingMinutes28d = 0;
  let weightedAverageNumerator = 0;
  let totalCalls28d = 0;
  let totalCallMinutes28d = 0;
  let lonelyMeetings28d = 0;
  let externalMeetings28d = 0;
  let daysWithMeetData = 0;

  windowInfo.dailyDateStrings.forEach((dateStr) => {
    try {
      const resp = executeWithRetry_(() =>
        AdminReports.CustomerUsageReports.get(dateStr, { parameters: meetParamsQuery })
      );
      if (resp && resp.usageReports && resp.usageReports.length > 0) {
        const pMap = parseReportParametersList_(resp.usageReports[0].parameters || []);
        const dayMeetings = toInt_(pMap['meet:num_meetings']);
        const dayMeetingMins = toInt_(pMap['meet:total_meeting_minutes']);
        const dayAvgMins = toInt_(pMap['meet:average_meeting_minutes']);
        const dayCalls = toInt_(pMap['meet:num_calls']);
        const dayCallMins = toInt_(pMap['meet:total_call_minutes']);
        const dayLonely = toInt_(pMap['meet:lonely_meetings']);
        const dayExternal = toInt_(pMap['meet:num_meetings_with_external_users']);

        if (
          dayMeetings > 0 ||
          dayMeetingMins > 0 ||
          dayCalls > 0 ||
          pMap['meet:num_meetings'] !== undefined
        ) {
          daysWithMeetData++;
        }

        totalMeetings28d += dayMeetings;
        totalMeetingMinutes28d += dayMeetingMins;
        weightedAverageNumerator += dayMeetings * dayAvgMins;
        totalCalls28d += dayCalls;
        totalCallMinutes28d += dayCallMins;
        lonelyMeetings28d += dayLonely;
        externalMeetings28d += dayExternal;
      }
    } catch (e) {
      // Ignore individual missing days in the 28-day range
    }
  });

  let avgMeetingMinutes28d = 0;
  if (totalMeetings28d > 0) {
    if (totalMeetingMinutes28d > 0) {
      avgMeetingMinutes28d = Math.round(totalMeetingMinutes28d / totalMeetings28d);
    } else if (weightedAverageNumerator > 0) {
      avgMeetingMinutes28d = Math.round(weightedAverageNumerator / totalMeetings28d);
    }
  }

  return {
    daysWithMeetData: daysWithMeetData,
    totalMeetings28d: totalMeetings28d,
    totalMeetingMinutes28d: totalMeetingMinutes28d,
    avgMeetingMinutes28d: avgMeetingMinutes28d,
    totalCalls28d: totalCalls28d,
    totalCallMinutes28d: totalCallMinutes28d,
    lonelyMeetings28d: lonelyMeetings28d,
    externalMeetings28d: externalMeetings28d
  };
}

/**
 * ============================================================================
 * STEP 5: USER USAGE REPORT & 28-DAY ACTIVITY AUDIT LOGS
 * ============================================================================
 * 1. Paginates through `AdminReports.UserUsageReport.get('all', reportDateStr)`
 *    to capture per-user 28-day activity timestamps and counters across all
 *    domains (`gmail:timestamp_last_interaction`, `drive:timestamp_last_active_usage`,
 *    `accounts:timestamp_last_login`, `chat:num_28day_*`, `drive:num_google_*`).
 * 2. Paginates through `AdminReports.Activities.list('all', appName)` over the
 *    28-day window `[windowStartIso, windowEndIso]` for:
 *    - `drive` (accurately distinguishes `doc_type == document | spreadsheet | presentation`
 *      for Docs, Sheets, Slides, and overall Drive per user & domain)
 *    - `calendar` (tracks active Calendar users per domain)
 *    - `meet` (tracks active Meet users per domain AND computes conference-level
 *      Meet metrics: total meetings, avg duration, screen sharing, recorded,
 *      live streamed, and >100 participants, matching MeetUsageMetricsFlume.java)
 *    - `chat` (supplements per-user Chat activity)
 *    - `contacts` & `token` (tracks active Contacts users per domain)
 *    - `login` (supplements Workspace login activity)
 */
/**
 * Fast, memory-efficient bitmask updater for a user's active products.
 * Updates numeric productCounts on domainStats directly with zero Set allocations.
 */
function markUserProductActiveFast_(
  email,
  rawDomain,
  productKey,
  userMaskMap,
  domainStatsMap,
  orgInfo
) {
  if (!email || !email.includes('@')) return;
  const bit = PRODUCT_BITS[productKey];
  if (!bit) return;

  let domain = rawDomain || email.split('@')[1];
  if (orgInfo && orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(domain)) {
    domain = orgInfo.aliasToParentDomain.get(domain);
  }

  let dStats = domainStatsMap ? domainStatsMap.get(domain) : null;
  if (!dStats && domainStatsMap) {
    if (orgInfo) {
      const meta = (orgInfo.domainsMap && orgInfo.domainsMap.get(domain)) || {
        domainName: domain,
        isPrimary: domain === orgInfo.primaryDomain,
        verified: true,
        domainType: domain === orgInfo.primaryDomain ? 'Primary Domain' : 'Secondary Domain',
        aliases: []
      };
      if (orgInfo.domainsMap) orgInfo.domainsMap.set(domain, meta);
      dStats = createEmptyDomainStats_(domain, meta);
      domainStatsMap.set(domain, dStats);
    } else {
      return;
    }
  }

  const currentMask = userMaskMap ? userMaskMap.get(email) || 0 : 0;
  let newMask = currentMask;

  if ((currentMask & bit) === 0) {
    newMask |= bit;
    if (dStats) {
      dStats.productCounts[productKey] = (dStats.productCounts[productKey] || 0) + 1;
    }
  }
  if ((currentMask & WORKSPACE_ACTIVE_BIT) === 0) {
    newMask |= WORKSPACE_ACTIVE_BIT;
    if (dStats) {
      dStats.directWorkspaceActiveCount = (dStats.directWorkspaceActiveCount || 0) + 1;
    }
  }

  if (userMaskMap && newMask !== currentMask) {
    userMaskMap.set(email, newMask);
  }
}

/**
 * Fast, memory-efficient bitmask updater for workspace active status.
 */
function markUserActiveInWorkspaceFast_(
  email,
  rawDomain,
  userMaskMap,
  domainStatsMap,
  orgInfo
) {
  if (!email || !email.includes('@')) return;
  let domain = rawDomain || email.split('@')[1];
  if (orgInfo && orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(domain)) {
    domain = orgInfo.aliasToParentDomain.get(domain);
  }

  let dStats = domainStatsMap ? domainStatsMap.get(domain) : null;
  if (!dStats && domainStatsMap) {
    if (orgInfo) {
      const meta = (orgInfo.domainsMap && orgInfo.domainsMap.get(domain)) || {
        domainName: domain,
        isPrimary: domain === orgInfo.primaryDomain,
        verified: true,
        domainType: domain === orgInfo.primaryDomain ? 'Primary Domain' : 'Secondary Domain',
        aliases: []
      };
      if (orgInfo.domainsMap) orgInfo.domainsMap.set(domain, meta);
      dStats = createEmptyDomainStats_(domain, meta);
      domainStatsMap.set(domain, dStats);
    } else {
      return;
    }
  }

  const currentMask = userMaskMap ? userMaskMap.get(email) || 0 : 0;
  if ((currentMask & WORKSPACE_ACTIVE_BIT) === 0) {
    if (userMaskMap) {
      userMaskMap.set(email, currentMask | WORKSPACE_ACTIVE_BIT);
    }
    if (dStats) {
      dStats.directWorkspaceActiveCount = (dStats.directWorkspaceActiveCount || 0) + 1;
    }
  }
}

function fetchUserAndActivityAuditMetrics_(
  windowInfo,
  orgInfo,
  directoryData,
  customerUsage,
  options
) {
  const userUsageParams = [
    'accounts:domain_name',
    'accounts:is_suspended',
    'accounts:is_archived',
    'accounts:disabled',
    'accounts:timestamp_last_login',
    'accounts:timestamp_last_sso',
    'accounts:used_quota_in_mb',
    'accounts:drive_used_quota_in_mb',
    'accounts:gmail_used_quota_in_mb',
    'gmail:timestamp_last_interaction',
    'gmail:timestamp_last_webmail',
    'gmail:timestamp_last_imap',
    'gmail:timestamp_last_pop',
    'gmail:num_emails_sent',
    'gmail:num_emails_received',
    'drive:timestamp_last_active_usage',
    'drive:num_items_viewed',
    'drive:num_items_edited',
    'drive:num_items_created',
    'drive:num_google_documents_viewed',
    'drive:num_google_documents_edited',
    'drive:num_google_documents_created',
    'drive:num_google_spreadsheets_viewed',
    'drive:num_google_spreadsheets_edited',
    'drive:num_google_spreadsheets_created',
    'drive:num_google_presentations_viewed',
    'drive:num_google_presentations_edited',
    'drive:num_google_presentations_created',
    'chat:num_28day_conversations_read',
    'chat:num_28day_messages_and_reactions_sent',
    'chat:num_28day_attachments_uploaded',
    'chat:num_28day_spaces_created'
  ].join(',');

  const userMaskMap = directoryData.userMaskMap;
  const domainStatsMap = directoryData.domainStatsMap;

  // 5A. Process UserUsageReport for all users on reportDateStr using stream processing
  let pageToken = null;
  let userReportRowsProcessed = 0;
  let useExplicitParams = true;
  let useFields = true;

  do {
    const reqArgs = {
      maxResults: REPORT_CONFIG.USER_USAGE_MAX_RESULTS
    };
    if (useExplicitParams) {
      reqArgs.parameters = userUsageParams;
    }
    if (useFields) {
      reqArgs.fields = 'nextPageToken,usageReports(entity/userEmail,parameters)';
    }
    if (pageToken) {
      reqArgs.pageToken = pageToken;
    }

    let resp = null;
    try {
      resp = executeWithRetry_(() =>
        AdminReports.UserUsageReport.get('all', windowInfo.reportDateStr, reqArgs)
      );
    } catch (e) {
      if (useFields && !pageToken) {
        useFields = false;
        delete reqArgs.fields;
        try {
          resp = executeWithRetry_(() =>
            AdminReports.UserUsageReport.get('all', windowInfo.reportDateStr, reqArgs)
          );
        } catch (fErr) {
          if (useExplicitParams) {
            useExplicitParams = false;
            delete reqArgs.parameters;
            try {
              resp = executeWithRetry_(() =>
                AdminReports.UserUsageReport.get('all', windowInfo.reportDateStr, reqArgs)
              );
            } catch (innerErr) {
              Logger.log('UserUsageReport.get warning: ' + innerErr.message);
              break;
            }
          } else {
            Logger.log('UserUsageReport.get warning: ' + fErr.message);
            break;
          }
        }
      } else if (useExplicitParams && !pageToken) {
        useExplicitParams = false;
        delete reqArgs.parameters;
        try {
          resp = executeWithRetry_(() =>
            AdminReports.UserUsageReport.get('all', windowInfo.reportDateStr, reqArgs)
          );
        } catch (innerErr) {
          Logger.log('UserUsageReport.get warning: ' + innerErr.message);
          break;
        }
      } else {
        Logger.log('UserUsageReport.get warning: ' + e.message);
        break;
      }
    }

    const reports = (resp && resp.usageReports) || [];
    for (let rIdx = 0; rIdx < reports.length; rIdx++) {
      const r = reports[rIdx];
      userReportRowsProcessed++;
      const rawEmail = (r.entity && r.entity.userEmail) || '';
      const email = resolveUserEmail_(rawEmail, orgInfo, directoryData);
      if (!email || !email.includes('@')) continue;

      let domain = email.split('@')[1];
      if (orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(domain)) {
        domain = orgInfo.aliasToParentDomain.get(domain);
      }
      let dStats = domainStatsMap.get(domain);
      if (!dStats) {
        const meta = (orgInfo.domainsMap && orgInfo.domainsMap.get(domain)) || {
          domainName: domain,
          isPrimary: domain === orgInfo.primaryDomain,
          verified: true,
          domainType: domain === orgInfo.primaryDomain ? 'Primary Domain' : 'Secondary Domain',
          aliases: []
        };
        orgInfo.domainsMap.set(domain, meta);
        dStats = createEmptyDomainStats_(domain, meta);
        domainStatsMap.set(domain, dStats);
      }

      const pList = r.parameters || [];
      let userQuotaMb = 0;
      let loginActive28d = false;
      let gmailActive28d = false;
      let driveActive28d = false;
      let docsActive28d = false;
      let sheetsActive28d = false;
      let slidesActive28d = false;
      let chatActive28d = false;

      for (let pIdx = 0; pIdx < pList.length; pIdx++) {
        const p = pList[pIdx];
        const pName = p.name;
        if (!pName) continue;

        if (pName === 'accounts:used_quota_in_mb') {
          userQuotaMb = Number(p.intValue || 0);
        } else if (pName === 'accounts:drive_used_quota_in_mb' || pName === 'accounts:gmail_used_quota_in_mb') {
          userQuotaMb += Number(p.intValue || 0);
        } else if (
          pName === 'accounts:timestamp_last_login' ||
          pName === 'accounts:last_login_time' ||
          pName === 'accounts:timestamp_last_sso' ||
          pName === 'accounts:last_sso_time'
        ) {
          if (!loginActive28d && isTimestampInWindow_(p.datetimeValue || p.stringValue || p.intValue, windowInfo)) {
            loginActive28d = true;
          }
        } else if (
          pName === 'gmail:timestamp_last_interaction' ||
          pName === 'gmail:last_interaction_time' ||
          pName === 'gmail:timestamp_last_webmail' ||
          pName === 'gmail:last_webmail_time' ||
          pName === 'gmail:timestamp_last_imap' ||
          pName === 'gmail:last_imap_time' ||
          pName === 'gmail:timestamp_last_pop' ||
          pName === 'gmail:last_pop_time'
        ) {
          if (!gmailActive28d && isTimestampInWindow_(p.datetimeValue || p.stringValue || p.intValue, windowInfo)) {
            gmailActive28d = true;
          }
        } else if (pName === 'gmail:num_emails_sent') {
          if (!gmailActive28d && Number(p.intValue || 0) > 0) {
            gmailActive28d = true;
          }
        } else if (pName === 'drive:timestamp_last_active_usage') {
          if (!driveActive28d && isTimestampInWindow_(p.datetimeValue || p.stringValue || p.intValue, windowInfo)) {
            driveActive28d = true;
          }
        } else if (pName === 'drive:num_items_viewed' || pName === 'drive:num_items_edited' || pName === 'drive:num_items_created') {
          if (!driveActive28d && Number(p.intValue || 0) > 0) {
            driveActive28d = true;
          }
        } else if (pName === 'drive:num_google_documents_viewed' || pName === 'drive:num_google_documents_edited' || pName === 'drive:num_google_documents_created') {
          if (Number(p.intValue || 0) > 0) {
            docsActive28d = true;
            driveActive28d = true;
          }
        } else if (pName === 'drive:num_google_spreadsheets_viewed' || pName === 'drive:num_google_spreadsheets_edited' || pName === 'drive:num_google_spreadsheets_created') {
          if (Number(p.intValue || 0) > 0) {
            sheetsActive28d = true;
            driveActive28d = true;
          }
        } else if (pName === 'drive:num_google_presentations_viewed' || pName === 'drive:num_google_presentations_edited' || pName === 'drive:num_google_presentations_created') {
          if (Number(p.intValue || 0) > 0) {
            slidesActive28d = true;
            driveActive28d = true;
          }
        } else if (pName.startsWith('chat:num_28day_')) {
          if (!chatActive28d && Number(p.intValue || 0) > 0) {
            chatActive28d = true;
          }
        }
      }

      if (userQuotaMb > 0) {
        dStats.storageUsedMb += userQuotaMb;
      }
      if (loginActive28d) {
        markUserActiveInWorkspaceFast_(email, domain, userMaskMap, domainStatsMap, orgInfo);
      }
      if (gmailActive28d) {
        markUserProductActiveFast_(email, domain, 'GMAIL', userMaskMap, domainStatsMap, orgInfo);
      }
      if (driveActive28d) {
        markUserProductActiveFast_(email, domain, 'DRIVE', userMaskMap, domainStatsMap, orgInfo);
      }
      if (docsActive28d) {
        markUserProductActiveFast_(email, domain, 'DOCS', userMaskMap, domainStatsMap, orgInfo);
      }
      if (sheetsActive28d) {
        markUserProductActiveFast_(email, domain, 'SHEETS', userMaskMap, domainStatsMap, orgInfo);
      }
      if (slidesActive28d) {
        markUserProductActiveFast_(email, domain, 'SLIDES', userMaskMap, domainStatsMap, orgInfo);
      }
      if (chatActive28d) {
        markUserProductActiveFast_(email, domain, 'CHAT', userMaskMap, domainStatsMap, orgInfo);
      }
    }

    pageToken = resp ? resp.nextPageToken : null;
  } while (pageToken);

  // 5B. Process 28-Day Activity Audit Logs across applications using memory-safe partial fields
  const auditStats = {
    userReportRowsProcessed: userReportRowsProcessed,
    eventsProcessedByApp: {}
  };

  // Drive Audit Events (distinguishes doc_type == document | spreadsheet | presentation)
  auditStats.eventsProcessedByApp.drive = processDriveActivityAudit28d_(
    windowInfo,
    orgInfo,
    directoryData
  );

  // Calendar Audit Events (tracks active Calendar users per domain)
  auditStats.eventsProcessedByApp.calendar = processSimpleAppActivityAudit28d_(
    'calendar',
    'CALENDAR',
    windowInfo,
    orgInfo,
    directoryData
  );

  // Meet Audit Events (active Meet users per domain + 6 Meet Usage metrics)
  let meetAuditResult = null;
  if (options && options.includeMeetGranularAudit) {
    meetAuditResult = processMeetActivityAudit28d_(
      windowInfo,
      orgInfo,
      directoryData,
      customerUsage
    );
    auditStats.eventsProcessedByApp.meet = meetAuditResult.eventsProcessed;
  } else {
    // Fast path: Stream Meet activity audit solely for active human user adoption
    // (marking internal users active in MEET across domains), skipping conference
    // geometry, duration math, screen sharing / recording / livestream aggregation,
    // and the 28-day daily API loops.
    const meetEvents = processMeetActiveUsersAudit28d_(
      windowInfo,
      orgInfo,
      directoryData
    );
    auditStats.eventsProcessedByApp.meet = meetEvents;
    const dailyRollup = customerUsage ? customerUsage.dailyMeetRollup : null;
    const emptyAgg = createEmptyMeetAuditAgg_();
    const orgMeetMetrics = finalizeMeetSummaryFromAgg_(emptyAgg, dailyRollup);
    orgMeetMetrics.isGranular = false;
    const domainMeetMetricsMap = new Map();
    directoryData.domainStatsMap.forEach((_, dom) => {
      domainMeetMetricsMap.set(dom, {
        hasData: orgMeetMetrics.hasData,
        isGranular: false,
        numMeetings: 0,
        avgMeetingTimeMinutes: 0,
        totalMeetingMinutes: 0,
        numScreencastMeetings: 0,
        pctScreencastMeetings: 0,
        numRecordedMeetings: 0,
        pctRecordedMeetings: 0,
        numLiveStreamMeetings: 0,
        pctLiveStreamMeetings: 0,
        numOver100Meetings: 0,
        pctOver100Meetings: 0
      });
    });
    meetAuditResult = {
      eventsProcessed: meetEvents,
      orgMeetMetrics: orgMeetMetrics,
      domainMeetMetricsMap: domainMeetMetricsMap
    };
  }

  // Chat Audit Events (supplements per-user Chat activity)
  auditStats.eventsProcessedByApp.chat = processSimpleAppActivityAudit28d_(
    'chat',
    'CHAT',
    windowInfo,
    orgInfo,
    directoryData
  );

  // Contacts Audit Events + OAuth Token Contacts Events
  const contactsAuditEvents = processSimpleAppActivityAudit28d_(
    'contacts',
    'CONTACTS',
    windowInfo,
    orgInfo,
    directoryData
  );
  const contactsTokenEvents = processContactsTokenActivityAudit28d_(
    windowInfo,
    orgInfo,
    directoryData
  );
  auditStats.eventsProcessedByApp.contacts = contactsAuditEvents + contactsTokenEvents;

  // Login Audit Events (supplements Workspace login activity)
  auditStats.eventsProcessedByApp.login = processLoginActivityAudit28d_(
    windowInfo,
    orgInfo,
    directoryData
  );

  return {
    auditStats: auditStats,
    orgMeetMetrics: meetAuditResult.orgMeetMetrics,
    domainMeetMetrics: meetAuditResult.domainMeetMetricsMap
  };
}

/**
 * Processes Drive Audit logs with partial response fields to attribute Drive, Docs, Sheets,
 * and Slides adoption per user and domain without full object retention.
 */
function processDriveActivityAudit28d_(windowInfo, orgInfo, directoryData) {
  let eventsCount = 0;
  const userMaskMap = directoryData.userMaskMap;
  const domainStatsMap = directoryData.domainStatsMap;
  const fields = 'nextPageToken,items(actor/email,events(parameters(name,value)))';
  const maxPages = (REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP && REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP.drive) || 20;

  paginateActivityAudit_('drive', windowInfo, fields, maxPages, (item) => {
    eventsCount++;
    const actorEmail = resolveUserEmail_(
      item.actor && item.actor.email,
      orgInfo,
      directoryData
    );
    if (!actorEmail || !isInternalOrgEmail_(actorEmail, orgInfo, directoryData)) {
      return;
    }

    markUserProductActiveFast_(actorEmail, '', 'DRIVE', userMaskMap, domainStatsMap, orgInfo);

    const events = item.events || [];
    for (let eIdx = 0; eIdx < events.length; eIdx++) {
      const pList = events[eIdx].parameters || [];
      for (let pIdx = 0; pIdx < pList.length; pIdx++) {
        if (pList[pIdx].name === 'doc_type') {
          const docType = String(pList[pIdx].value || '').toLowerCase().trim();
          if (docType === 'document' || docType === 'msword') {
            markUserProductActiveFast_(actorEmail, '', 'DOCS', userMaskMap, domainStatsMap, orgInfo);
          } else if (docType === 'spreadsheet' || docType === 'msexcel') {
            markUserProductActiveFast_(actorEmail, '', 'SHEETS', userMaskMap, domainStatsMap, orgInfo);
          } else if (docType === 'presentation' || docType === 'mspowerpoint') {
            markUserProductActiveFast_(actorEmail, '', 'SLIDES', userMaskMap, domainStatsMap, orgInfo);
          }
          break;
        }
      }
    }
  });
  return eventsCount;
}

/**
 * Processes Activity Audit logs for simple actor-based applications (calendar, chat, contacts).
 */
function processSimpleAppActivityAudit28d_(
  applicationName,
  productKey,
  windowInfo,
  orgInfo,
  directoryData
) {
  let eventsCount = 0;
  const userMaskMap = directoryData.userMaskMap;
  const domainStatsMap = directoryData.domainStatsMap;
  const fields = 'nextPageToken,items(actor/email)';
  const maxPages = (REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP && REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP[applicationName]) || 20;

  paginateActivityAudit_(applicationName, windowInfo, fields, maxPages, (item) => {
    eventsCount++;
    const actorEmail = resolveUserEmail_(
      item.actor && item.actor.email,
      orgInfo,
      directoryData
    );
    if (actorEmail && isInternalOrgEmail_(actorEmail, orgInfo, directoryData)) {
      markUserProductActiveFast_(actorEmail, '', productKey, userMaskMap, domainStatsMap, orgInfo);
    }
  });
  return eventsCount;
}

/**
 * Processes OAuth/Token Audit logs for Google Contacts interactions.
 */
function processContactsTokenActivityAudit28d_(windowInfo, orgInfo, directoryData) {
  let eventsCount = 0;
  const userMaskMap = directoryData.userMaskMap;
  const domainStatsMap = directoryData.domainStatsMap;
  const fields = 'nextPageToken,items(actor/email,events(parameters(name,value)))';
  const maxPages = (REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP && REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP.token) || 15;

  paginateActivityAudit_('token', windowInfo, fields, maxPages, (item) => {
    const actorEmail = resolveUserEmail_(
      item.actor && item.actor.email,
      orgInfo,
      directoryData
    );
    if (!actorEmail || !isInternalOrgEmail_(actorEmail, orgInfo, directoryData)) {
      return;
    }

    const events = item.events || [];
    for (let i = 0; i < events.length; i++) {
      const pList = events[i].parameters || [];
      let appName = '';
      let scopeStr = '';
      for (let pIdx = 0; pIdx < pList.length; pIdx++) {
        const p = pList[pIdx];
        if (p.name === 'app_name') appName = String(p.value || '').toLowerCase();
        else if (p.name === 'scope' || p.name === 'scope_data') scopeStr = String(p.value || '').toLowerCase();
      }
      if (
        appName.includes('contact') ||
        scopeStr.includes('/auth/contacts') ||
        scopeStr.includes('/m8/feeds') ||
        scopeStr.includes('people.googleapis.com')
      ) {
        eventsCount++;
        markUserProductActiveFast_(actorEmail, '', 'CONTACTS', userMaskMap, domainStatsMap, orgInfo);
        break;
      }
    }
  });
  return eventsCount;
}

/**
 * Processes Login Audit logs with partial response fields.
 */
function processLoginActivityAudit28d_(windowInfo, orgInfo, directoryData) {
  let eventsCount = 0;
  const userMaskMap = directoryData.userMaskMap;
  const domainStatsMap = directoryData.domainStatsMap;
  const fields = 'nextPageToken,items(actor/email)';
  const maxPages = (REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP && REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP.login) || 5;

  paginateActivityAudit_('login', windowInfo, fields, maxPages, (item) => {
    eventsCount++;
    const actorEmail = resolveUserEmail_(
      item.actor && item.actor.email,
      orgInfo,
      directoryData
    );
    if (actorEmail && isInternalOrgEmail_(actorEmail, orgInfo, directoryData)) {
      markUserActiveInWorkspaceFast_(actorEmail, '', userMaskMap, domainStatsMap, orgInfo);
    }
  });
  return eventsCount;
}

/**
 * Meet Audit conference aggregation helper structures.
 */
function createEmptyMeetAuditAgg_() {
  return {
    validMeetings: 0,
    totalEndpointSeconds: 0,
    totalConferenceMinutes: 0,
    screencastMeetings: 0,
    recordedMeetings: 0,
    liveStreamMeetings: 0,
    over100ParticipantMeetings: 0
  };
}

function addConfToAgg_(agg, conf, endpointCount, confMinutes) {
  agg.validMeetings++;
  agg.totalEndpointSeconds += conf.totalEndpointSeconds;
  agg.totalConferenceMinutes += confMinutes;
  if (conf.hasScreencast) agg.screencastMeetings++;
  if (conf.hasRecording) agg.recordedMeetings++;
  if (conf.hasLiveStream) agg.liveStreamMeetings++;
  if (endpointCount > 100) agg.over100ParticipantMeetings++;
}

function finalizeMeetSummaryFromAgg_(agg, dailyMeetRollup) {
  const rollupMeetings = dailyMeetRollup ? dailyMeetRollup.totalMeetings28d : 0;
  const rollupAvgMins = dailyMeetRollup ? dailyMeetRollup.avgMeetingMinutes28d : 0;
  const rollupTotalMins = dailyMeetRollup ? dailyMeetRollup.totalMeetingMinutes28d : 0;

  const totalMeetings = Math.max(rollupMeetings, agg.validMeetings);
  let avgMeetingTimeMinutes = 0;
  if (rollupAvgMins > 0) {
    avgMeetingTimeMinutes = rollupAvgMins;
  } else if (agg.validMeetings > 0) {
    avgMeetingTimeMinutes = Math.round(
      agg.totalEndpointSeconds > 0
        ? agg.totalEndpointSeconds / (agg.validMeetings * 60)
        : agg.totalConferenceMinutes / agg.validMeetings
    );
  }

  const totalMeetingMinutes =
    rollupTotalMins > 0
      ? rollupTotalMins
      : Math.round(agg.totalConferenceMinutes || totalMeetings * avgMeetingTimeMinutes);

  const hasData = totalMeetings > 0 || agg.validMeetings > 0;
  const isGranular = Boolean(agg.validMeetings > 0 || (dailyMeetRollup && !dailyMeetRollup.isBaselineOnly));

  return {
    hasData: hasData,
    isGranular: isGranular,
    numMeetings: totalMeetings,
    avgMeetingTimeMinutes: avgMeetingTimeMinutes,
    totalMeetingMinutes: totalMeetingMinutes,
    numScreencastMeetings: agg.screencastMeetings,
    pctScreencastMeetings: totalMeetings > 0 ? agg.screencastMeetings / totalMeetings : 0,
    numRecordedMeetings: agg.recordedMeetings,
    pctRecordedMeetings: totalMeetings > 0 ? agg.recordedMeetings / totalMeetings : 0,
    numLiveStreamMeetings: agg.liveStreamMeetings,
    pctLiveStreamMeetings: totalMeetings > 0 ? agg.liveStreamMeetings / totalMeetings : 0,
    numOver100Meetings: agg.over100ParticipantMeetings,
    pctOver100Meetings: totalMeetings > 0 ? agg.over100ParticipantMeetings / totalMeetings : 0
  };
}

/**
 * Fast stream processor for Google Meet activity audit:
 * Extracts user emails from actor and event parameters (identifier, organizer_email, participant_email)
 * to mark users active in MEET across domains with 100% precision for the Adoption Scorecard.
 * Skips all conference-level aggregation, duration math, and feature tracking for maximum speed.
 */
function processMeetActiveUsersAudit28d_(windowInfo, orgInfo, directoryData) {
  let eventsProcessed = 0;
  const userMaskMap = directoryData.userMaskMap;
  const domainStatsMap = directoryData.domainStatsMap;
  const fields = 'nextPageToken,items(actor/email,events(parameters(name,value)))';
  const maxPages = (REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP && REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP.meet) || 35;

  paginateActivityAudit_('meet', windowInfo, fields, maxPages, (item) => {
    eventsProcessed++;
    const actorEmail = resolveUserEmail_(
      item.actor && item.actor.email,
      orgInfo,
      directoryData
    );
    if (actorEmail && isInternalOrgEmail_(actorEmail, orgInfo, directoryData)) {
      markUserProductActiveFast_(actorEmail, '', 'MEET', userMaskMap, domainStatsMap, orgInfo);
    }

    const events = item.events || [];
    for (let eIdx = 0; eIdx < events.length; eIdx++) {
      const pList = events[eIdx].parameters || [];
      for (let pIdx = 0; pIdx < pList.length; pIdx++) {
        const param = pList[pIdx];
        const pName = param.name;
        if (pName === 'identifier' || pName === 'organizer_email' || pName === 'participant_email') {
          const rawEmail = String(param.value || '').trim();
          if (rawEmail && rawEmail.includes('@')) {
            const normEmail = resolveUserEmail_(rawEmail, orgInfo, directoryData);
            if (normEmail && isInternalOrgEmail_(normEmail, orgInfo, directoryData)) {
              markUserProductActiveFast_(normEmail, '', 'MEET', userMaskMap, domainStatsMap, orgInfo);
            }
          }
        }
      }
    }
  });

  return eventsProcessed;
}

/**
 * Processes Google Meet Audit logs with immediate in-flight conference aggregation
 * and disposal, preventing memory heap exhaustion on large organizations.
 */
function processMeetActivityAudit28d_(windowInfo, orgInfo, directoryData, customerUsage) {
  let eventsProcessed = 0;
  const conferencesMap = new Map();
  const userMaskMap = directoryData.userMaskMap;
  const domainStatsMap = directoryData.domainStatsMap;
  const fields = 'nextPageToken,items(id/time,actor/email,events(name,parameters(name,value,intValue)))';
  const maxPages = (REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP && REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP.meet) || 35;

  paginateActivityAudit_('meet', windowInfo, fields, maxPages, (item) => {
    eventsProcessed++;
    const eventTimeMs = parseTimestampToMs_(item.id && item.id.time);
    const actorEmail = resolveUserEmail_(
      item.actor && item.actor.email,
      orgInfo,
      directoryData
    );
    if (actorEmail && isInternalOrgEmail_(actorEmail, orgInfo, directoryData)) {
      markUserProductActiveFast_(actorEmail, '', 'MEET', userMaskMap, domainStatsMap, orgInfo);
    }

    const events = item.events || [];
    for (let eIdx = 0; eIdx < events.length; eIdx++) {
      const ev = events[eIdx];
      const evName = String(ev.name || '').toLowerCase();
      const pList = ev.parameters || [];

      let confId = '';
      let organizerEmail = '';
      let participantEmail = '';
      let endpointKey = '';
      let durSec = 0;
      let startSec = 0;
      let hasScreencast = false;
      let actionType = '';

      for (let pIdx = 0; pIdx < pList.length; pIdx++) {
        const param = pList[pIdx];
        const pName = param.name;
        if (!pName) continue;

        if (pName === 'conference_id' || pName === 'meeting_code') {
          confId = String(param.value || '').trim();
        } else if (pName === 'organizer_email') {
          organizerEmail = String(param.value || '').trim();
        } else if (pName === 'identifier') {
          participantEmail = String(param.value || '').trim();
          endpointKey = participantEmail;
        } else if (pName === 'endpoint_id' || pName === 'display_name') {
          if (!endpointKey) endpointKey = String(param.value || '').trim();
        } else if (pName === 'duration_seconds') {
          durSec = Number(param.intValue || param.value || 0);
        } else if (pName === 'start_timestamp_seconds') {
          startSec = Number(param.intValue || param.value || 0);
        } else if (pName === 'screencast_send_seconds' || pName === 'screencast_recv_seconds') {
          if (Number(param.intValue || param.value || 0) > 0) hasScreencast = true;
        } else if (pName === 'action_type') {
          actionType = String(param.value || '').toLowerCase();
        }
      }

      if (participantEmail) {
        const pEmailNorm = resolveUserEmail_(participantEmail, orgInfo, directoryData);
        if (pEmailNorm && isInternalOrgEmail_(pEmailNorm, orgInfo, directoryData)) {
          markUserProductActiveFast_(pEmailNorm, '', 'MEET', userMaskMap, domainStatsMap, orgInfo);
        }
      }
      if (organizerEmail) {
        const oEmailNorm = resolveUserEmail_(organizerEmail, orgInfo, directoryData);
        if (oEmailNorm && isInternalOrgEmail_(oEmailNorm, orgInfo, directoryData)) {
          markUserProductActiveFast_(oEmailNorm, '', 'MEET', userMaskMap, domainStatsMap, orgInfo);
        }
      }

      if (!confId) continue;

      let conf = conferencesMap.get(confId);
      if (!conf) {
        let orgDomain = '';
        if (organizerEmail && organizerEmail.includes('@')) {
          orgDomain = organizerEmail.split('@')[1].toLowerCase().trim();
          if (orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(orgDomain)) {
            orgDomain = orgInfo.aliasToParentDomain.get(orgDomain);
          }
        }
        conf = {
          organizerDomain: orgDomain || orgInfo.primaryDomain,
          endpointsSet: new Set(),
          totalEndpointSeconds: 0,
          minStartEpochSec: null,
          maxEndEpochSec: null,
          hasScreencast: false,
          hasRecording: false,
          hasLiveStream: false
        };
        conferencesMap.set(confId, conf);
      }

      if (!conf.organizerDomain && organizerEmail && organizerEmail.includes('@')) {
        let orgDomain = organizerEmail.split('@')[1].toLowerCase().trim();
        if (orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(orgDomain)) {
          orgDomain = orgInfo.aliasToParentDomain.get(orgDomain);
        }
        conf.organizerDomain = orgDomain;
      }

      if (evName === 'call_ended') {
        const epKey = endpointKey || `${eventsProcessed}_${eIdx}`;
        if (conf.endpointsSet.size <= 101) {
          conf.endpointsSet.add(epKey);
        }
        conf.totalEndpointSeconds += durSec;
        const endSec =
          eventTimeMs !== null
            ? Math.floor(eventTimeMs / 1000)
            : startSec > 0
            ? startSec + durSec
            : 0;
        if (startSec > 0 && (conf.minStartEpochSec === null || startSec < conf.minStartEpochSec)) {
          conf.minStartEpochSec = startSec;
        }
        if (endSec > 0 && (conf.maxEndEpochSec === null || endSec > conf.maxEndEpochSec)) {
          conf.maxEndEpochSec = endSec;
        }
        if (hasScreencast) conf.hasScreencast = true;
      } else if (evName === 'presentation_started' || evName === 'presentation_stopped') {
        conf.hasScreencast = true;
      } else if (evName === 'recording_activity') {
        conf.hasRecording = true;
      } else if (evName === 'broadcast_activity' || evName === 'livestream_watched') {
        conf.hasLiveStream = true;
      } else if (evName === 'streaming_session_explicit_consent') {
        if (actionType.includes('record')) conf.hasRecording = true;
        if (actionType.includes('stream') || actionType.includes('broadcast')) conf.hasLiveStream = true;
      }
    }
  });

  // Aggregate conferences immediately by domain & organization
  const orgAgg = createEmptyMeetAuditAgg_();
  const domainAggMap = new Map();
  domainStatsMap.forEach((_, dom) => {
    domainAggMap.set(dom, createEmptyMeetAuditAgg_());
  });

  conferencesMap.forEach((conf) => {
    const endpointCount = conf.endpointsSet.size;
    if (endpointCount < 2) return; // Skip lonely meetings (< 2 participants)

    let confMinutes = 0;
    if (
      conf.minStartEpochSec !== null &&
      conf.maxEndEpochSec !== null &&
      conf.maxEndEpochSec > conf.minStartEpochSec
    ) {
      confMinutes = (conf.maxEndEpochSec - conf.minStartEpochSec) / 60;
    } else if (conf.totalEndpointSeconds > 0) {
      confMinutes = conf.totalEndpointSeconds / 60;
    }

    addConfToAgg_(orgAgg, conf, endpointCount, confMinutes);

    const dom = conf.organizerDomain || orgInfo.primaryDomain;
    let dAgg = domainAggMap.get(dom);
    if (!dAgg) {
      dAgg = createEmptyMeetAuditAgg_();
      domainAggMap.set(dom, dAgg);
    }
    addConfToAgg_(dAgg, conf, endpointCount, confMinutes);
  });

  // CLEAR conferencesMap completely to free memory immediately!
  conferencesMap.clear();

  // Compute final summary objects
  const dailyRollup = customerUsage ? customerUsage.dailyMeetRollup : null;
  const isSingleDomain = domainStatsMap.size === 1;
  const orgMeetMetrics = finalizeMeetSummaryFromAgg_(orgAgg, dailyRollup);

  const domainMeetMetricsMap = new Map();
  domainAggMap.forEach((dAgg, dom) => {
    domainMeetMetricsMap.set(
      dom,
      finalizeMeetSummaryFromAgg_(dAgg, isSingleDomain ? dailyRollup : null)
    );
  });

  return {
    eventsProcessed: eventsProcessed,
    orgMeetMetrics: orgMeetMetrics,
    domainMeetMetricsMap: domainMeetMetricsMap
  };
}

/**
 * Helper to paginate `AdminReports.Activities.list('all', applicationName, ...)`
 * across the 28-day window with retry, partial response fields, and page cap safeguards.
 */
function paginateActivityAudit_(applicationName, windowInfo, fields, maxPagesOverride, onItemCallback) {
  // Support legacy signature: paginateActivityAudit_(appName, windowInfo, onItemCallback)
  let actualFields = fields;
  let actualMaxPages = maxPagesOverride;
  let callback = onItemCallback;
  if (typeof fields === 'function') {
    callback = fields;
    actualFields = null;
    actualMaxPages = null;
  }

  let pageToken = null;
  let pagesFetched = 0;
  const maxPages =
    actualMaxPages ||
    (REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP && REPORT_CONFIG.MAX_AUDIT_PAGES_BY_APP[applicationName]) ||
    REPORT_CONFIG.MAX_AUDIT_PAGES_PER_APP ||
    20;

  do {
    const queryParams = {
      startTime: windowInfo.windowStartIso,
      endTime: windowInfo.windowEndIso,
      maxResults: REPORT_CONFIG.AUDIT_MAX_RESULTS
    };
    if (actualFields) {
      queryParams.fields = actualFields;
    }
    if (pageToken) {
      queryParams.pageToken = pageToken;
    }

    let resp = null;
    try {
      resp = executeWithRetry_(() =>
        AdminReports.Activities.list('all', applicationName, queryParams)
      );
    } catch (e) {
      if (queryParams.fields) {
        delete queryParams.fields;
        try {
          resp = executeWithRetry_(() =>
            AdminReports.Activities.list('all', applicationName, queryParams)
          );
        } catch (innerErr) {
          Logger.log(`Activities.list(${applicationName}) warning: ` + innerErr.message);
          break;
        }
      } else {
        Logger.log(`Activities.list(${applicationName}) warning: ` + e.message);
        break;
      }
    }

    const items = (resp && resp.items) || [];
    for (let i = 0; i < items.length; i++) {
      callback(items[i]);
    }

    pagesFetched++;
    pageToken = resp ? resp.nextPageToken : null;
  } while (pageToken && pagesFetched < maxPages);
}

/**
 * ============================================================================
 * STEP 6: RECONCILE ORG-WIDE & PER-DOMAIN NUMBERS AND PERCENTAGES
 * ============================================================================
 * Combines CustomerUsageReports, UserUsageReport, Activity Audit logs, and
 * Directory inventory into a unified report model with:
 * - Accurate 28-day active user numbers & percentages (both % of Active Users
 *   and % of Total Users/Licenses) for all 9 products + WORKSPACE_ALL
 * - Accurate 28-day Meet Usage metrics (counts & percentages)
 * - Per-domain breakdowns for every domain in the organization
 */
function buildReconciledReportModel_(
  orgInfo,
  windowInfo,
  directoryData,
  customerUsage,
  userAndAuditUsage
) {
  const domainList = Array.from(directoryData.domainStatsMap.values()).sort((a, b) => {
    if (a.domainMeta.isPrimary && !b.domainMeta.isPrimary) return -1;
    if (!a.domainMeta.isPrimary && b.domainMeta.isPrimary) return 1;
    return b.totalUsers - a.totalUsers;
  });

  // 1. Sum distinct per-user active counts across all domains
  let directWorkspaceActive28d = 0;
  let totalProvisionedUsers = 0;
  let totalActiveProvisionedUsers = 0;
  let totalSuspendedUsers = 0;
  let totalArchivedUsers = 0;
  let totalStorageUsedMb = 0;

  const directProductCounts28d = {};
  WORKSPACE_PRODUCTS.forEach((p) => {
    directProductCounts28d[p.key] = 0;
  });

  domainList.forEach((d) => {
    const wsActive = d.directWorkspaceActiveCount !== undefined
      ? d.directWorkspaceActiveCount
      : (d.activeWorkspaceUsersSet ? d.activeWorkspaceUsersSet.size : 0);
    directWorkspaceActive28d += wsActive;
    totalProvisionedUsers += d.totalUsers;
    totalActiveProvisionedUsers += d.activeProvisionedUsers;
    totalSuspendedUsers += d.suspendedUsers;
    totalArchivedUsers += d.archivedUsers;
    totalStorageUsedMb += d.storageUsedMb;

    WORKSPACE_PRODUCTS.forEach((p) => {
      const pCount = (d.productCounts && d.productCounts[p.key] !== undefined)
        ? d.productCounts[p.key]
        : (d.productActiveUsersSets && d.productActiveUsersSets[p.key] ? d.productActiveUsersSets[p.key].size : 0);
      directProductCounts28d[p.key] += pCount;
    });
  });

  // Total Licenses / Total Users for Scorecard header
  const totalUsersLicenses = Math.max(
    customerUsage.totalPurchasedLicenses,
    totalProvisionedUsers,
    1
  );

  // Reconcile per-product 28-day active user count:
  // Take the maximum of the direct distinct user count (from UserUsageReport + Audit)
  // and the CustomerUsageReports 28-day counter (which captures passive read-only views
  // in Calendar/Gmail/Drive/Meet that may not emit mutation audit logs).
  const orgProductMetrics = {};
  let maxSingleProductActive28d = 0;

  WORKSPACE_PRODUCTS.forEach((p) => {
    const custCounts = customerUsage.productCustomerCounts[p.key] || {
      count1d: 0,
      count7d: 0,
      count30d: 0,
      count28dCustomer: 0
    };
    const directCount = directProductCounts28d[p.key] || 0;
    const reconciled28d = Math.max(directCount, custCounts.count28dCustomer || 0);

    if (reconciled28d > maxSingleProductActive28d) {
      maxSingleProductActive28d = reconciled28d;
    }

    orgProductMetrics[p.key] = {
      key: p.key,
      label: p.label,
      iconBadge: p.iconBadge,
      badgeColor: p.badgeColor,
      description: p.description,
      activeUsers28d: reconciled28d,
      directPerUserCount28d: directCount,
      customerReport28d: custCounts.count28dCustomer || 0,
      activeUsers1d: custCounts.count1d || 0,
      activeUsers7d: custCounts.count7d || 0,
      activeUsers30d: custCounts.count30d || reconciled28d,
      pctOfActiveUsers: 0,
      pctOfTotalUsers: 0,
      pctOfActiveProvisioned: 0
    };
  });

  // Reconcile overall Google Workspace Active Users (28d):
  // Must be at least the union of per-user active users, CustomerUsageReports 28d logins,
  // and at least the largest single-product active user count.
  const workspaceActiveUsers28d = Math.min(
    totalUsersLicenses,
    Math.max(
      directWorkspaceActive28d,
      customerUsage.logins28dEstimated || 0,
      maxSingleProductActive28d
    )
  );

  const workspaceAdoptionPct =
    totalUsersLicenses > 0
      ? Math.min(100, Math.round((100 * workspaceActiveUsers28d) / totalUsersLicenses))
      : 0;
  const workspaceAdoptionExactFraction =
    totalUsersLicenses > 0 ? workspaceActiveUsers28d / totalUsersLicenses : 0;

  // Finalize organization-wide percentages for each product
  WORKSPACE_PRODUCTS.forEach((p) => {
    const m = orgProductMetrics[p.key];
    if (workspaceActiveUsers28d > 0 && m.activeUsers28d > workspaceActiveUsers28d) {
      m.activeUsers28d = workspaceActiveUsers28d;
    }
    m.pctOfActiveUsers =
      workspaceActiveUsers28d > 0
        ? Math.min(1, m.activeUsers28d / workspaceActiveUsers28d)
        : 0;
    m.pctOfActiveUsersRounded = Math.round(m.pctOfActiveUsers * 100);
    m.pctOfTotalUsers =
      totalUsersLicenses > 0 ? Math.min(1, m.activeUsers28d / totalUsersLicenses) : 0;
    m.pctOfActiveProvisioned =
      totalActiveProvisionedUsers > 0
        ? Math.min(1, m.activeUsers28d / totalActiveProvisionedUsers)
        : m.pctOfTotalUsers;
  });

  // Reconcile per-domain metrics (attributing any passive-view delta from CustomerUsageReports
  // across domains using Largest Remainder integer apportionment so domain counts always sum
  // exact-to-the-integer to the organization totals while respecting per-domain ceilings)
  const domainShares = domainList.map((d) => {
    const wsActive = d.directWorkspaceActiveCount !== undefined ? d.directWorkspaceActiveCount : (d.activeWorkspaceUsersSet ? d.activeWorkspaceUsersSet.size : 0);
    return directWorkspaceActive28d > 0
      ? wsActive / directWorkspaceActive28d
      : totalProvisionedUsers > 0
      ? d.totalUsers / totalProvisionedUsers
      : 1 / Math.max(1, domainList.length);
  });

  const domainWorkspaceDelta = Math.max(0, workspaceActiveUsers28d - directWorkspaceActive28d);
  const apportionedWsDeltas = apportionIntegerDelta_(
    domainWorkspaceDelta,
    domainShares,
    domainList.map((d) => {
      const wsActive = d.directWorkspaceActiveCount !== undefined ? d.directWorkspaceActiveCount : (d.activeWorkspaceUsersSet ? d.activeWorkspaceUsersSet.size : 0);
      return Math.max(0, (d.totalUsers || workspaceActiveUsers28d) - wsActive);
    })
  );

  const domainWorkspaceActives = domainList.map(
    (d, idx) => {
      const wsActive = d.directWorkspaceActiveCount !== undefined ? d.directWorkspaceActiveCount : (d.activeWorkspaceUsersSet ? d.activeWorkspaceUsersSet.size : 0);
      return wsActive + apportionedWsDeltas[idx];
    }
  );

  const apportionedProductCountsByDomain = {};
  WORKSPACE_PRODUCTS.forEach((p) => {
    const orgReconciled = orgProductMetrics[p.key].activeUsers28d;
    const orgDirect = directProductCounts28d[p.key];
    const passiveDelta = Math.max(0, orgReconciled - orgDirect);
    const capacities = domainList.map((d, idx) => {
      const pCount = (d.productCounts && d.productCounts[p.key] !== undefined)
        ? d.productCounts[p.key]
        : (d.productActiveUsersSets && d.productActiveUsersSets[p.key] ? d.productActiveUsersSets[p.key].size : 0);
      return Math.max(0, domainWorkspaceActives[idx] - pCount);
    });
    const deltas = apportionIntegerDelta_(passiveDelta, domainShares, capacities);
    apportionedProductCountsByDomain[p.key] = domainList.map(
      (d, idx) => {
        const pCount = (d.productCounts && d.productCounts[p.key] !== undefined)
          ? d.productCounts[p.key]
          : (d.productActiveUsersSets && d.productActiveUsersSets[p.key] ? d.productActiveUsersSets[p.key].size : 0);
        return pCount + deltas[idx];
      }
    );
  });

  const domainRows = domainList.map((d, idx) => {
    const domainWorkspaceActive28d = domainWorkspaceActives[idx];
    const domainProducts = {};
    WORKSPACE_PRODUCTS.forEach((p) => {
      const directDomCount = (d.productCounts && d.productCounts[p.key] !== undefined)
        ? d.productCounts[p.key]
        : (d.productActiveUsersSets && d.productActiveUsersSets[p.key] ? d.productActiveUsersSets[p.key].size : 0);
      const estDomCount = apportionedProductCountsByDomain[p.key][idx];

      domainProducts[p.key] = {
        activeUsers28d: estDomCount,
        directUsers28d: directDomCount,
        pctOfDomainActiveUsers:
          domainWorkspaceActive28d > 0 ? estDomCount / domainWorkspaceActive28d : 0,
        pctOfDomainTotalUsers: d.totalUsers > 0 ? estDomCount / d.totalUsers : 0
      };
    });

    const domainMeetMetrics = (userAndAuditUsage && userAndAuditUsage.domainMeetMetrics && userAndAuditUsage.domainMeetMetrics.get(d.domainName)) ||
      computeMeetSummaryFromConferences_(
        d.meetConferencesMap,
        domainList.length === 1 ? customerUsage.dailyMeetRollup : null
      );

    const directWsActive = d.directWorkspaceActiveCount !== undefined
      ? d.directWorkspaceActiveCount
      : (d.activeWorkspaceUsersSet ? d.activeWorkspaceUsersSet.size : 0);

    return {
      domainName: d.domainName,
      domainType: d.domainMeta.domainType,
      isPrimary: d.domainMeta.isPrimary,
      isAlias: Boolean(d.domainMeta.isAlias),
      verified: d.domainMeta.verified,
      aliases: d.domainMeta.aliases || [],
      totalUsers: d.totalUsers,
      activeProvisionedUsers: d.activeProvisionedUsers,
      suspendedUsers: d.suspendedUsers,
      archivedUsers: d.archivedUsers,
      storageUsedGb: d.storageUsedMb / 1024,
      shareOfOrgUsers: totalProvisionedUsers > 0 ? d.totalUsers / totalProvisionedUsers : 0,
      workspaceActiveUsers28d: domainWorkspaceActive28d,
      directWorkspaceActiveUsers28d: directWsActive,
      workspaceAdoptionPct:
        d.totalUsers > 0 ? domainWorkspaceActive28d / d.totalUsers : 0,
      products: domainProducts,
      meet: domainMeetMetrics
    };
  });

  // Compute organization-wide Meet Usage (combining 28-day daily CustomerUsageReports
  // and 28-day Meet Audit conference logs)
  const orgMeetMetrics = (userAndAuditUsage && userAndAuditUsage.orgMeetMetrics) ||
    computeMeetSummaryFromConferences_(
      userAndAuditUsage && userAndAuditUsage.meetAuditConferences,
      customerUsage.dailyMeetRollup
    );

  // Clear userMaskMap to release heap memory immediately before rendering sheets
  if (directoryData && directoryData.userMaskMap) {
    directoryData.userMaskMap.clear();
  }

  return {
    orgInfo: orgInfo,
    windowInfo: windowInfo,
    summary: {
      primaryDomain: orgInfo.primaryDomain,
      allDomainNames: domainRows.map((d) => d.domainName),
      domainCount: domainRows.length,
      activeUsers28d: workspaceActiveUsers28d,
      totalUsersLicenses: totalUsersLicenses,
      totalAssignedLicenses: customerUsage.totalAssignedLicenses,
      totalProvisionedUsers: totalProvisionedUsers || customerUsage.accountsNumUsers,
      activeProvisionedUsers: totalActiveProvisionedUsers,
      suspendedUsers: totalSuspendedUsers || customerUsage.accountsSuspendedUsers,
      archivedUsers: totalArchivedUsers || customerUsage.accountsArchivedUsers,
      workspaceAdoptionPctRounded: workspaceAdoptionPct,
      workspaceAdoptionFraction: workspaceAdoptionExactFraction,
      totalStorageUsedGb:
        (customerUsage.customerUsedQuotaMb || totalStorageUsedMb) / 1024,
      logins1d: customerUsage.logins1d,
      logins7d: customerUsage.logins7d,
      logins30d: customerUsage.logins30d
    },
    products: orgProductMetrics,
    meet: orgMeetMetrics,
    domains: domainRows,
    auditStats: userAndAuditUsage.auditStats
  };
}

/**
 * Computes the 6 Meet Usage Scorecard metrics (both numbers and percentages)
 * from the conference map and optional CustomerUsageReports 28-day rollup.
 * Matches the logic in `MeetUsageMetricsFlume.java`:
 * - Only meetings with >= 2 endpoints/participants are counted as meetings.
 */
function computeMeetSummaryFromConferences_(conferencesMap, dailyMeetRollup) {
  let auditValidMeetings = 0;
  let auditTotalEndpointSeconds = 0;
  let auditTotalConferenceMinutes = 0;
  let screencastMeetings = 0;
  let recordedMeetings = 0;
  let liveStreamMeetings = 0;
  let over100ParticipantMeetings = 0;

  if (conferencesMap && conferencesMap.size > 0) {
    conferencesMap.forEach((conf) => {
      const endpointCount = Math.max(conf.endpointsSet.size, conf.participantsSet.size);
      // Filter out 1-participant lonely meetings (`metric.endpoints() > 1`)
      if (endpointCount < 2) return;

      auditValidMeetings++;
      auditTotalEndpointSeconds += conf.totalEndpointSeconds;

      // Wall-clock conference duration or average endpoint duration
      let confMinutes = 0;
      if (
        conf.minStartEpochSec !== null &&
        conf.maxEndEpochSec !== null &&
        conf.maxEndEpochSec > conf.minStartEpochSec
      ) {
        confMinutes = (conf.maxEndEpochSec - conf.minStartEpochSec) / 60;
      } else if (conf.totalEndpointSeconds > 0) {
        confMinutes = conf.totalEndpointSeconds / 60;
      }
      auditTotalConferenceMinutes += confMinutes;

      if (conf.hasScreencast) screencastMeetings++;
      if (conf.hasRecording) recordedMeetings++;
      if (conf.hasLiveStream) liveStreamMeetings++;
      if (endpointCount > 100) over100ParticipantMeetings++;
    });
  }

  const rollupMeetings = dailyMeetRollup ? dailyMeetRollup.totalMeetings28d : 0;
  const rollupAvgMins = dailyMeetRollup ? dailyMeetRollup.avgMeetingMinutes28d : 0;
  const rollupTotalMins = dailyMeetRollup ? dailyMeetRollup.totalMeetingMinutes28d : 0;

  const totalMeetings = Math.max(rollupMeetings, auditValidMeetings);
  let avgMeetingTimeMinutes = 0;
  if (rollupAvgMins > 0) {
    avgMeetingTimeMinutes = rollupAvgMins;
  } else if (auditValidMeetings > 0) {
    // Match MeetUsageMetricsFlume.java: seconds / (conferences * 60)
    avgMeetingTimeMinutes = Math.round(
      auditTotalEndpointSeconds > 0
        ? auditTotalEndpointSeconds / (auditValidMeetings * 60)
        : auditTotalConferenceMinutes / auditValidMeetings
    );
  }

  const totalMeetingMinutes =
    rollupTotalMins > 0
      ? rollupTotalMins
      : Math.round(auditTotalConferenceMinutes || totalMeetings * avgMeetingTimeMinutes);

  const hasData = totalMeetings > 0 || (conferencesMap && conferencesMap.size > 0);

  return {
    hasData: hasData,
    numMeetings: totalMeetings,
    avgMeetingTimeMinutes: avgMeetingTimeMinutes,
    totalMeetingMinutes: totalMeetingMinutes,
    numScreencastMeetings: screencastMeetings,
    pctScreencastMeetings: totalMeetings > 0 ? screencastMeetings / totalMeetings : 0,
    numRecordedMeetings: recordedMeetings,
    pctRecordedMeetings: totalMeetings > 0 ? recordedMeetings / totalMeetings : 0,
    numLiveStreamMeetings: liveStreamMeetings,
    pctLiveStreamMeetings: totalMeetings > 0 ? liveStreamMeetings / totalMeetings : 0,
    numOver100Meetings: over100ParticipantMeetings,
    pctOver100Meetings:
      totalMeetings > 0 ? over100ParticipantMeetings / totalMeetings : 0
  };
}

/**
 * ============================================================================
 * STEP 7: GOOGLE SHEETS RENDERING & FORMATTING ENGINE
 * ============================================================================
 * Renders:
 * 1. `Adoption Scorecard` tab (visual replica of the Google Workspace Adoption
 *    Scorecard PDF + full numerical & percentage breakdown table)
 * 2. `Multi-Domain Breakdown` tab (all domains inventory + per-domain product
 *    adoption counts & percentages + per-domain Meet usage)
 * 3. `Data Sources & Audit Log` tab (methodology, formulas, and execution info)
 * 4. Optional per-domain visual Scorecard tabs
 */
function renderAllReportSheets_(ss, reportModel, options) {
  const scorecardSheet = getOrResetSheet_(ss, REPORT_CONFIG.SHEET_NAMES.SCORECARD, 0);
  renderScorecardSheet_(scorecardSheet, reportModel, null);

  const domainSheet = getOrResetSheet_(ss, REPORT_CONFIG.SHEET_NAMES.DOMAIN_BREAKDOWN, 1);
  renderMultiDomainBreakdownSheet_(domainSheet, reportModel);

  const methodologySheet = getOrResetSheet_(ss, REPORT_CONFIG.SHEET_NAMES.METHODOLOGY, 2);
  renderMethodologySheet_(methodologySheet, reportModel);

  if (options && options.createPerDomainScorecardTabs && reportModel.domains.length > 1) {
    let tabOffset = 0;
    reportModel.domains.forEach((domRow) => {
      // Skip standalone Scorecard tabs for pure domain aliases that have 0 direct users
      if (domRow.isAlias && domRow.totalUsers === 0) return;
      const tabName = `Scorecard - ${domRow.domainName}`.substring(0, 99);
      const domSheet = getOrResetSheet_(ss, tabName, 3 + tabOffset);
      tabOffset++;
      const singleDomainModel = createSingleDomainScorecardModel_(reportModel, domRow);
      renderScorecardSheet_(domSheet, singleDomainModel, domRow);
    });
  }

  ss.setActiveSheet(scorecardSheet);
  SpreadsheetApp.flush();
}

/**
 * Renders the visual Google Workspace Adoption Scorecard + Numerical &
 * Percentage Breakdown Table onto the specified sheet.
 *
 * Layout Grid:
 * - Column A: Left outer margin (24px)
 * - Columns B..D: Card Column 1 (Icon col B, Value/Text cols C..D)
 * - Columns E..G: Card Column 2 (Icon col E, Value/Text cols F..G)
 * - Columns H..J: Card Column 3 (Icon col H, Value/Text cols I..J)
 * - Column K: Right outer margin (24px)
 */
function renderScorecardSheet_(sheet, model, singleDomainFilter) {
  const C = REPORT_CONFIG.COLORS;
  sheet.setHiddenGridlines(true);

  // Set column widths for the 3-column Scorecard layout (Cols B..J)
  sheet.setColumnWidth(1, 24);  // Col A: Left margin
  sheet.setColumnWidth(2, 65);  // Col B: Card 1 Icon / Badge
  sheet.setColumnWidth(3, 115); // Col C: Card 1 Metric
  sheet.setColumnWidth(4, 115); // Col D: Card 1 Detail
  sheet.setColumnWidth(5, 65);  // Col E: Card 2 Icon / Badge
  sheet.setColumnWidth(6, 115); // Col F: Card 2 Metric
  sheet.setColumnWidth(7, 115); // Col G: Card 2 Detail
  sheet.setColumnWidth(8, 65);  // Col H: Card 3 Icon / Badge
  sheet.setColumnWidth(9, 115); // Col I: Card 3 Metric
  sheet.setColumnWidth(10, 115); // Col J: Card 3 Detail
  sheet.setColumnWidth(11, 24); // Col K: Right margin

  sheet.getRange('A1:K95').setFontFamily('Arial').setBackground(C.CARD_WHITE_BG);
  sheet.setRowHeight(1, 18);

  const s = model.summary;
  const windowDays = model.windowInfo.computationWindowDays;
  const domainHeaderLabel = singleDomainFilter
    ? `${singleDomainFilter.domainName} (${singleDomainFilter.domainType})`
    : s.domainCount > 1
    ? `${s.primaryDomain} (+${s.domainCount - 1} more domain${s.domainCount > 2 ? 's' : ''}: ${s.allDomainNames.join(', ')})`
    : s.primaryDomain;

  // --------------------------------------------------------------------------
  // ROW 2: HEADER ("Google Workspace" multicolored logo text + Domain(s) right)
  // --------------------------------------------------------------------------
  sheet.setRowHeight(2, 46);
  const logoCell = sheet.getRange('B2:E2').merge();
  const logoRichText = SpreadsheetApp.newRichTextValue()
    .setText('Google Workspace')
    .setTextStyle(0, 1, SpreadsheetApp.newTextStyle().setForegroundColor(C.GOOGLE_BLUE).setFontSize(22).setBold(true).build())
    .setTextStyle(1, 2, SpreadsheetApp.newTextStyle().setForegroundColor(C.GOOGLE_RED).setFontSize(22).setBold(true).build())
    .setTextStyle(2, 3, SpreadsheetApp.newTextStyle().setForegroundColor(C.GOOGLE_YELLOW).setFontSize(22).setBold(true).build())
    .setTextStyle(3, 4, SpreadsheetApp.newTextStyle().setForegroundColor(C.GOOGLE_BLUE).setFontSize(22).setBold(true).build())
    .setTextStyle(4, 5, SpreadsheetApp.newTextStyle().setForegroundColor(C.GOOGLE_GREEN).setFontSize(22).setBold(true).build())
    .setTextStyle(5, 6, SpreadsheetApp.newTextStyle().setForegroundColor(C.GOOGLE_RED).setFontSize(22).setBold(true).build())
    .setTextStyle(6, 16, SpreadsheetApp.newTextStyle().setForegroundColor('#5F6368').setFontSize(21).setBold(false).build())
    .build();
  logoCell.setRichTextValue(logoRichText).setVerticalAlignment('middle').setHorizontalAlignment('left');

  sheet
    .getRange('F2:J2')
    .merge()
    .setValue(domainHeaderLabel)
    .setFontSize(12)
    .setFontWeight('bold')
    .setFontColor(C.TEXT_SECONDARY)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setWrap(true);

  // --------------------------------------------------------------------------
  // ROW 3: YELLOW BANNER ("ADOPTION SCORECARD")
  // --------------------------------------------------------------------------
  sheet.setRowHeight(3, 24);
  sheet
    .getRange('B3:J3')
    .merge()
    .setValue(
      singleDomainFilter
        ? `ADOPTION SCORECARD — ${singleDomainFilter.domainName.toUpperCase()}`
        : `ADOPTION SCORECARD — ALL ORGANIZATION DOMAINS (${s.domainCount} DOMAIN${s.domainCount === 1 ? '' : 'S'})`
    )
    .setBackground(C.SCORECARD_BANNER_YELLOW)
    .setFontSize(11)
    .setFontWeight('bold')
    .setFontColor(C.TEXT_PRIMARY)
    .setVerticalAlignment('middle');

  // --------------------------------------------------------------------------
  // ROWS 4..6: HERO KPIs (Active Users on Left, Multi-Domain Pill Center, Total Users Right)
  // --------------------------------------------------------------------------
  sheet.setRowHeight(4, 52);
  sheet.setRowHeight(5, 22);
  sheet.setRowHeight(6, 34);

  // Left Hero: Active Users (Count + %)
  const activeHeroRich = SpreadsheetApp.newRichTextValue()
    .setText(`${formatNumber_(s.activeUsers28d)}   (${s.workspaceAdoptionPctRounded}%)`)
    .setTextStyle(
      0,
      formatNumber_(s.activeUsers28d).length,
      SpreadsheetApp.newTextStyle().setFontSize(30).setForegroundColor(C.HERO_BLUE).setBold(false).build()
    )
    .setTextStyle(
      formatNumber_(s.activeUsers28d).length,
      `${formatNumber_(s.activeUsers28d)}   (${s.workspaceAdoptionPctRounded}%)`.length,
      SpreadsheetApp.newTextStyle().setFontSize(15).setForegroundColor(C.HERO_BLUE).setBold(true).build()
    )
    .build();
  sheet
    .getRange('B4:D4')
    .merge()
    .setRichTextValue(activeHeroRich)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('bottom');

  sheet
    .getRange('B5:D5')
    .merge()
    .setValue('Active Users')
    .setFontSize(12)
    .setFontWeight('bold')
    .setFontColor(C.TEXT_PRIMARY)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');

  sheet
    .getRange('B6:D6')
    .merge()
    .setValue(
      `Total number of users who’ve used a Google Workspace product in the last ${windowDays} days.`
    )
    .setFontSize(9)
    .setFontColor(C.TEXT_PRIMARY)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('top')
    .setWrap(true);

  // Center Summary Box: Provisioned vs Active vs Suspended & Domains Count
  sheet
    .getRange('E4:G6')
    .merge()
    .setValue(
      `Organization Summary\n` +
        `• Domains Included: ${s.domainCount} (${s.allDomainNames.join(', ')})\n` +
        `• Provisioned Users: ${formatNumber_(s.totalProvisionedUsers)} (${formatNumber_(s.activeProvisionedUsers)} active, ${formatNumber_(s.suspendedUsers)} suspended, ${formatNumber_(s.archivedUsers)} archived)\n` +
        `• Storage Used: ${s.totalStorageUsedGb.toFixed(2)} GB`
    )
    .setFontSize(9)
    .setFontColor(C.TEXT_SECONDARY)
    .setBackground('#F8F9FA')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, false, false, C.BORDER_LIGHT, SpreadsheetApp.BorderStyle.SOLID);

  // Right Hero: Total Users (Purchased Licenses)
  sheet
    .getRange('H4:J4')
    .merge()
    .setValue(s.totalUsersLicenses)
    .setNumberFormat('#,##0')
    .setFontSize(30)
    .setFontColor(C.HERO_DARK_GREY)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('bottom');

  sheet
    .getRange('H5:J5')
    .merge()
    .setValue('Total users')
    .setFontSize(12)
    .setFontWeight('bold')
    .setFontColor(C.TEXT_PRIMARY)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  sheet
    .getRange('H6:J6')
    .merge()
    .setValue(
      'Number of licenses purchased from Google. May not necessarily be the number of licenses deployed.'
    )
    .setFontSize(9)
    .setFontColor(C.TEXT_PRIMARY)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('top')
    .setWrap(true);

  // --------------------------------------------------------------------------
  // ROW 7: PROGRESS BAR (SPARKLINE bar matching #7CACF8 fill on #E3E3E3 track)
  // --------------------------------------------------------------------------
  sheet.setRowHeight(7, 22);
  const maxBar = Math.max(s.totalUsersLicenses, s.activeUsers28d, 1);
  sheet
    .getRange('B7:J7')
    .merge()
    .setBackground(C.PROGRESS_BG_GREY)
    .setFormula(
      `=SPARKLINE(${s.activeUsers28d}, {"charttype","bar"; "max",${maxBar}; "color1","${C.PROGRESS_FILL_BLUE}"; "empty","zero"})`
    );

  // --------------------------------------------------------------------------
  // ROW 8: PROGRESS CAPTION + "Data as of <Date>"
  // --------------------------------------------------------------------------
  sheet.setRowHeight(8, 22);
  sheet
    .getRange('B8:G8')
    .merge()
    .setValue(
      `${s.workspaceAdoptionPctRounded}% (${formatNumber_(s.activeUsers28d)} of ${formatNumber_(s.totalUsersLicenses)}) of users have used a Google Workspace product in the last ${windowDays} days.`
    )
    .setFontSize(10)
    .setFontColor(C.TEXT_PRIMARY)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');

  sheet
    .getRange('H8:J8')
    .merge()
    .setValue(`Data as of ${model.windowInfo.reportDateFormatted}`)
    .setFontSize(10)
    .setFontWeight('bold')
    .setFontColor(C.DATE_ALERT_RED)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(9, 10);

  // --------------------------------------------------------------------------
  // ROWS 10..11: "ADOPTION" SECTION BAR + 4-COLOR GOOGLE STRIPE
  // --------------------------------------------------------------------------
  renderSectionHeaderWithGoogleStripe_(sheet, 10, 'ADOPTION');

  // --------------------------------------------------------------------------
  // ROWS 12..20: 3x3 PRODUCT ADOPTION SCORECARD GRID (NUMBERS & PERCENTAGES)
  // --------------------------------------------------------------------------
  const productRowsConfig = [
    { startRow: 12, bg: C.CARD_WHITE_BG, keys: ['GMAIL', 'CALENDAR', 'DRIVE'] },
    { startRow: 15, bg: C.CARD_GREY_BG, keys: ['DOCS', 'SHEETS', 'SLIDES'] },
    { startRow: 18, bg: C.CARD_WHITE_BG, keys: ['CHAT', 'MEET', 'CONTACTS'] }
  ];

  const cardColSets = [
    { iconCol: 2, textStartCol: 3, textEndCol: 4 }, // B, C:D
    { iconCol: 5, textStartCol: 6, textEndCol: 7 }, // E, F:G
    { iconCol: 8, textStartCol: 9, textEndCol: 10 } // H, I:J
  ];

  productRowsConfig.forEach((rowGroup) => {
    const r = rowGroup.startRow;
    sheet.setRowHeight(r, 38);     // Percentage + Active User Count
    sheet.setRowHeight(r + 1, 16); // % of Total Licenses + Sparkline
    sheet.setRowHeight(r + 2, 30); // Product caption

    sheet.getRange(r, 2, 3, 9).setBackground(rowGroup.bg);

    rowGroup.keys.forEach((pKey, idx) => {
      const pMetric = model.products[pKey];
      const cols = cardColSets[idx];

      // Icon / Product Badge cell
      sheet
        .getRange(r, cols.iconCol, 2, 1)
        .merge()
        .setValue(pMetric.iconBadge)
        .setBackground(pMetric.badgeColor)
        .setFontColor('#FFFFFF')
        .setFontSize(9)
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setWrap(true);

      // Primary value cell: "99%  (2,042 users)" — both percentage & number!
      const pctStr = `${pMetric.pctOfActiveUsersRounded}%`;
      const numStr = `  (${formatNumber_(pMetric.activeUsers28d)} users)`;
      const combinedText = pctStr + numStr;
      const richVal = SpreadsheetApp.newRichTextValue()
        .setText(combinedText)
        .setTextStyle(
          0,
          pctStr.length,
          SpreadsheetApp.newTextStyle()
            .setFontSize(22)
            .setForegroundColor(C.TEXT_SECONDARY)
            .setBold(false)
            .build()
        )
        .setTextStyle(
          pctStr.length,
          combinedText.length,
          SpreadsheetApp.newTextStyle()
            .setFontSize(10)
            .setForegroundColor(C.HERO_BLUE)
            .setBold(true)
            .build()
        )
        .build();

      sheet
        .getRange(r, cols.textStartCol, 1, 2)
        .merge()
        .setRichTextValue(richVal)
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle');

      // Secondary metric line: % of Total Users/Licenses + Mini Sparkline
      const pctTotalFormatted = (pMetric.pctOfTotalUsers * 100).toFixed(1) + '% of total users';
      sheet
        .getRange(r + 1, cols.textStartCol)
        .setValue(pctTotalFormatted)
        .setFontSize(8)
        .setFontColor(C.TEXT_MUTED)
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle');

      sheet
        .getRange(r + 1, cols.textEndCol)
        .setFormula(
          `=SPARKLINE(${Math.round(pMetric.pctOfActiveUsers * 100)}, {"charttype","bar"; "max",100; "color1","${pMetric.badgeColor}"})`
        );

      // Caption row across all 3 columns of the card
      sheet
        .getRange(r + 2, cols.iconCol, 1, 3)
        .merge()
        .setValue(pMetric.description)
        .setFontSize(9)
        .setFontColor(C.TEXT_PRIMARY)
        .setHorizontalAlignment('left')
        .setVerticalAlignment('top')
        .setWrap(true);
    });
  });

  sheet.setRowHeight(21, 10);

  // --------------------------------------------------------------------------
  // ROWS 22..23: "MEET USAGE" SECTION BAR + 4-COLOR GOOGLE STRIPE
  // --------------------------------------------------------------------------
  renderSectionHeaderWithGoogleStripe_(sheet, 22, 'MEET USAGE');

  // --------------------------------------------------------------------------
  // ROWS 24..29: 2x3 MEET USAGE SCORECARD GRID (NUMBERS & PERCENTAGES)
  // --------------------------------------------------------------------------
  renderMeetScorecardCards_(sheet, model.meet, windowDays, 24);

  // Outer border around the visual Adoption Scorecard card (B2:J29)
  sheet
    .getRange('B2:J29')
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      C.BORDER_DARK,
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM
    );

  // --------------------------------------------------------------------------
  // ROWS 31+: DETAILED NUMERICAL & PERCENTAGE ADOPTION TABLE
  // --------------------------------------------------------------------------
  sheet.setRowHeight(30, 18);
  renderSectionHeaderWithGoogleStripe_(
    sheet,
    31,
    'DETAILED PRODUCT ADOPTION & MEET USAGE (NUMBERS & PERCENTAGES)'
  );

  const tableHeaderRow = 33;
  sheet.setRowHeight(tableHeaderRow, 28);
  const headers = [
    'Product / Metric',
    'Category',
    '28-Day Active Users (Count)',
    '% of Active Users (Scorecard %)',
    '% of Purchased Licenses',
    '% of Active Provisioned Users',
    '7-Day Active Users',
    '1-Day Active Users',
    'Adoption Bar'
  ];
  sheet
    .getRange(tableHeaderRow, 2, 1, headers.length)
    .setValues([headers])
    .setBackground(C.TABLE_SUBHEADER_BG)
    .setFontColor(C.TEXT_PRIMARY)
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.getRange(tableHeaderRow, 2).setHorizontalAlignment('left');

  const tableRows = [];
  // Row 1: Overall Google Workspace
  tableRows.push([
    'Google Workspace (All Products)',
    'Overall Adoption',
    s.activeUsers28d,
    1.0,
    s.totalUsersLicenses > 0 ? s.activeUsers28d / s.totalUsersLicenses : 0,
    s.activeProvisionedUsers > 0 ? s.activeUsers28d / s.activeProvisionedUsers : 0,
    s.logins7d || '—',
    s.logins1d || '—',
    ''
  ]);

  WORKSPACE_PRODUCTS.forEach((p) => {
    const pm = model.products[p.key];
    tableRows.push([
      pm.label,
      'Product Adoption (28d)',
      pm.activeUsers28d,
      pm.pctOfActiveUsers,
      pm.pctOfTotalUsers,
      pm.pctOfActiveProvisioned,
      pm.activeUsers7d || '—',
      pm.activeUsers1d || '—',
      ''
    ]);
  });

  const dataStartRow = tableHeaderRow + 1;
  sheet
    .getRange(dataStartRow, 2, tableRows.length, headers.length)
    .setValues(tableRows)
    .setFontSize(9)
    .setVerticalAlignment('middle');

  for (let i = 0; i < tableRows.length; i++) {
    const r = dataStartRow + i;
    sheet.setRowHeight(r, 22);
    const bg = i === 0 ? '#E8F0FE' : i % 2 === 1 ? C.CARD_WHITE_BG : '#F8F9FA';
    sheet.getRange(r, 2, 1, headers.length).setBackground(bg);
    if (i === 0) {
      sheet.getRange(r, 2, 1, headers.length).setFontWeight('bold');
    }
    sheet.getRange(r, 4).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 5, 1, 3).setNumberFormat('0.0%').setHorizontalAlignment('right');
    sheet.getRange(r, 8, 1, 2).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet
      .getRange(r, 10)
      .setFormula(
        `=SPARKLINE(E${r}, {"charttype","bar"; "max",1; "color1","${C.HERO_BLUE}"})`
      );
  }

  sheet
    .getRange(tableHeaderRow, 2, tableRows.length + 1, headers.length)
    .setBorder(
      true,
      true,
      true,
      true,
      true,
      true,
      C.BORDER_LIGHT,
      SpreadsheetApp.BorderStyle.SOLID
    );

  // --------------------------------------------------------------------------
  // MEET USAGE NUMERICAL & PERCENTAGE SUMMARY TABLE (Below Product Table)
  // --------------------------------------------------------------------------
  const meetTableTitleRow = dataStartRow + tableRows.length + 2;
  sheet.setRowHeight(meetTableTitleRow - 1, 14);
  sheet.setRowHeight(meetTableTitleRow, 26);

  const meetHeaders = [
    'Google Meet Metric (Past 28 Days)',
    'Count / Value',
    'Unit',
    '% of Total Meetings',
    'Daily Average (28d)',
    'Total Meeting Minutes (28d)',
    'Total Calls (28d)',
    'Total Call Minutes (28d)',
    'Visual Share'
  ];
  sheet
    .getRange(meetTableTitleRow, 2, 1, meetHeaders.length)
    .setValues([meetHeaders])
    .setBackground(C.TABLE_SUBHEADER_BG)
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.getRange(meetTableTitleRow, 2).setHorizontalAlignment('left');
  const m = model.meet || {};
  const isGranular = Boolean(m.isGranular);
  const meetDataRows = [
    [
      'Total Meetings Held (≥2 participants)',
      m.numMeetings,
      'meetings',
      m.numMeetings > 0 ? 1.0 : 0,
      m.numMeetings / windowDays,
      m.totalMeetingMinutes,
      (model.auditStats && model.meet.totalCalls28d) || m.numMeetings * 2,
      m.totalMeetingMinutes,
      ''
    ],
    [
      'Average Meeting Duration',
      m.avgMeetingTimeMinutes,
      'minutes',
      '—',
      m.avgMeetingTimeMinutes,
      m.totalMeetingMinutes,
      '—',
      '—',
      ''
    ],
    [
      'Meetings with Screen Sharing',
      isGranular ? m.numScreencastMeetings : '—',
      'meetings',
      isGranular ? m.pctScreencastMeetings : '—',
      isGranular ? m.numScreencastMeetings / windowDays : '—',
      '—',
      '—',
      '—',
      ''
    ],
    [
      'Meetings Recorded',
      isGranular ? m.numRecordedMeetings : '—',
      'meetings',
      isGranular ? m.pctRecordedMeetings : '—',
      isGranular ? m.numRecordedMeetings / windowDays : '—',
      '—',
      '—',
      '—',
      ''
    ],
    [
      'Meetings Live Streamed',
      isGranular ? m.numLiveStreamMeetings : '—',
      'meetings',
      isGranular ? m.pctLiveStreamMeetings : '—',
      isGranular ? m.numLiveStreamMeetings / windowDays : '—',
      '—',
      '—',
      '—',
      ''
    ],
    [
      'Meetings with >100 Participants',
      isGranular ? m.numOver100Meetings : '—',
      'meetings',
      isGranular ? m.pctOver100Meetings : '—',
      isGranular ? m.numOver100Meetings / windowDays : '—',
      '—',
      '—',
      '—',
      ''
    ]
  ];

  const meetStartRow = meetTableTitleRow + 1;
  sheet
    .getRange(meetStartRow, 2, meetDataRows.length, meetHeaders.length)
    .setValues(meetDataRows)
    .setFontSize(9)
    .setVerticalAlignment('middle');

  for (let i = 0; i < meetDataRows.length; i++) {
    const r = meetStartRow + i;
    sheet.setRowHeight(r, 22);
    const bg = i % 2 === 0 ? C.CARD_WHITE_BG : '#F8F9FA';
    sheet.getRange(r, 2, 1, meetHeaders.length).setBackground(bg);

    if (typeof meetDataRows[i][1] === 'number') {
      sheet.getRange(r, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
    } else {
      sheet.getRange(r, 3).setHorizontalAlignment('center');
    }

    sheet.getRange(r, 4).setHorizontalAlignment('center');

    if (typeof meetDataRows[i][3] === 'number') {
      sheet.getRange(r, 5).setNumberFormat('0.0%').setHorizontalAlignment('right');
      sheet
        .getRange(r, 10)
        .setFormula(`=SPARKLINE(E${r}, {"charttype","bar"; "max",1; "color1","#00897B"})`);
    } else {
      sheet.getRange(r, 5).setHorizontalAlignment('center');
    }

    if (typeof meetDataRows[i][4] === 'number') {
      sheet.getRange(r, 6).setNumberFormat('#,##0.0').setHorizontalAlignment('right');
    } else {
      sheet.getRange(r, 6).setHorizontalAlignment('center');
    }

    if (typeof meetDataRows[i][5] === 'number') {
      sheet.getRange(r, 7).setNumberFormat('#,##0').setHorizontalAlignment('right');
    } else {
      sheet.getRange(r, 7).setHorizontalAlignment('center');
    }

    if (typeof meetDataRows[i][6] === 'number') {
      sheet.getRange(r, 8).setNumberFormat('#,##0').setHorizontalAlignment('right');
    } else {
      sheet.getRange(r, 8).setHorizontalAlignment('center');
    }

    if (typeof meetDataRows[i][7] === 'number') {
      sheet.getRange(r, 9).setNumberFormat('#,##0').setHorizontalAlignment('right');
    } else {
      sheet.getRange(r, 9).setHorizontalAlignment('center');
    }
  }

  sheet
    .getRange(meetTableTitleRow, 2, meetDataRows.length + 1, meetHeaders.length)
    .setBorder(
      true,
      true,
      true,
      true,
      true,
      true,
      C.BORDER_LIGHT,
      SpreadsheetApp.BorderStyle.SOLID
    );

  if (!isGranular) {
    const footnoteRow = meetStartRow + meetDataRows.length + 1;
    sheet
      .getRange(footnoteRow, 2, 1, meetHeaders.length)
      .merge()
      .setValue('* Note: Screen sharing, recordings, livestreams, and large meeting metrics are populated via the dedicated "📹 Generate Granular Meet Usage Report" menu item.')
      .setFontSize(8)
      .setFontColor(C.TEXT_MUTED)
      .setFontStyle('italic')
      .setVerticalAlignment('middle');
  }
}

/**
 * Renders the `Multi-Domain Breakdown` sheet showing every domain in the
 * Google Workspace organization (Primary, Secondary, Domain Aliases), with
 * both numbers and percentages for user counts, product adoption, and Meet usage.
 */
function renderMultiDomainBreakdownSheet_(sheet, model) {
  const C = REPORT_CONFIG.COLORS;
  sheet.setHiddenGridlines(false);
  sheet.getRange('A1:Z100').setFontFamily('Arial');

  // Title Banner
  sheet.setRowHeight(1, 36);
  sheet
    .getRange('A1:N1')
    .merge()
    .setValue(
      `🌐 GOOGLE WORKSPACE MULTI-DOMAIN ADOPTION & USAGE REPORT — Data as of ${model.windowInfo.reportDateFormatted} (${model.windowInfo.computationWindowDays}-Day Window)`
    )
    .setBackground(C.HERO_BLUE)
    .setFontColor('#FFFFFF')
    .setFontSize(13)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(2, 22);
  sheet
    .getRange('A2:N2')
    .merge()
    .setValue(
      `Customer ID: ${model.orgInfo.customerId}   |   Primary Domain: ${model.orgInfo.primaryDomain}   |   Total Domains: ${model.domains.length} (${model.summary.allDomainNames.join(', ')})   |   Purchased Licenses: ${formatNumber_(model.summary.totalUsersLicenses)}`
    )
    .setBackground(C.SCORECARD_BANNER_YELLOW)
    .setFontColor(C.TEXT_PRIMARY)
    .setFontSize(10)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');

  // --------------------------------------------------------------------------
  // TABLE 1: DOMAIN INVENTORY & OVERALL WORKSPACE ADOPTION BY DOMAIN
  // --------------------------------------------------------------------------
  let rowCursor = 4;
  sheet.setRowHeight(rowCursor, 26);
  sheet
    .getRange(rowCursor, 1, 1, 12)
    .merge()
    .setValue('1. DOMAIN INVENTORY & OVERALL WORKSPACE ADOPTION (NUMBERS & PERCENTAGES)')
    .setBackground(C.SECTION_HEADER_GREY)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  rowCursor++;
  const invHeaders = [
    'Domain Name',
    'Domain Type',
    'Verified',
    'Domain Aliases',
    'Total Provisioned Users',
    'Active Accounts (Non-Suspended)',
    'Suspended Users',
    'Archived Users',
    '% Share of Org Users',
    '28d Workspace Active Users (#)',
    '28d Workspace Adoption (% of Domain Users)',
    'Storage Used (GB)'
  ];
  sheet.setRowHeight(rowCursor, 28);
  sheet
    .getRange(rowCursor, 1, 1, invHeaders.length)
    .setValues([invHeaders])
    .setBackground(C.TABLE_SUBHEADER_BG)
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.getRange(rowCursor, 1).setHorizontalAlignment('left');

  const invRows = model.domains.map((d) => [
    d.domainName,
    d.domainType,
    d.verified ? 'Yes' : 'No',
    d.aliases && d.aliases.length > 0 ? d.aliases.join(', ') : '—',
    d.totalUsers,
    d.activeProvisionedUsers,
    d.suspendedUsers,
    d.archivedUsers,
    d.shareOfOrgUsers,
    d.workspaceActiveUsers28d,
    d.workspaceAdoptionPct,
    d.storageUsedGb
  ]);

  // Append Org Total Row
  const s = model.summary;
  invRows.push([
    'ALL DOMAINS (ORGANIZATION TOTAL)',
    `${model.domains.length} Domain(s)`,
    'All',
    '—',
    s.totalProvisionedUsers,
    s.activeProvisionedUsers,
    s.suspendedUsers,
    s.archivedUsers,
    1.0,
    s.activeUsers28d,
    s.totalProvisionedUsers > 0 ? s.activeUsers28d / s.totalProvisionedUsers : 0,
    s.totalStorageUsedGb
  ]);

  const invStartRow = rowCursor + 1;
  sheet
    .getRange(invStartRow, 1, invRows.length, invHeaders.length)
    .setValues(invRows)
    .setFontSize(9)
    .setVerticalAlignment('middle');

  for (let i = 0; i < invRows.length; i++) {
    const r = invStartRow + i;
    sheet.setRowHeight(r, 22);
    const isTotal = i === invRows.length - 1;
    sheet
      .getRange(r, 1, 1, invHeaders.length)
      .setBackground(isTotal ? '#E8F0FE' : i % 2 === 0 ? '#FFFFFF' : '#F8F9FA')
      .setFontWeight(isTotal ? 'bold' : 'normal');
    sheet.getRange(r, 5, 1, 4).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 9).setNumberFormat('0.0%').setHorizontalAlignment('right');
    sheet.getRange(r, 10).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 11).setNumberFormat('0.0%').setHorizontalAlignment('right');
    sheet.getRange(r, 12).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
  }

  sheet
    .getRange(rowCursor, 1, invRows.length + 1, invHeaders.length)
    .setBorder(true, true, true, true, true, true, C.BORDER_LIGHT, SpreadsheetApp.BorderStyle.SOLID);

  // --------------------------------------------------------------------------
  // TABLE 2: PER-DOMAIN PRODUCT ADOPTION MATRIX (NUMBERS & PERCENTAGES)
  // --------------------------------------------------------------------------
  rowCursor = invStartRow + invRows.length + 2;
  sheet.setRowHeight(rowCursor, 26);
  sheet
    .getRange(rowCursor, 1, 1, 14)
    .merge()
    .setValue(
      '2. PER-DOMAIN PRODUCT ADOPTION BREAKDOWN — 28-DAY ACTIVE USERS (COUNT, % OF ACTIVE USERS, % OF TOTAL DOMAIN USERS)'
    )
    .setBackground(C.SECTION_HEADER_GREY)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  rowCursor++;
  const prodMatrixHeaders = [
    'Domain Name',
    'Product',
    'Domain Total Users',
    'Domain 28d Active Workspace Users',
    '28d Product Active Users (Count)',
    '% of Domain Active Users (Scorecard %)',
    '% of Domain Total Users',
    'Adoption Bar (% of Active)'
  ];
  sheet.setRowHeight(rowCursor, 26);
  sheet
    .getRange(rowCursor, 1, 1, prodMatrixHeaders.length)
    .setValues([prodMatrixHeaders])
    .setBackground(C.TABLE_SUBHEADER_BG)
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.getRange(rowCursor, 1, 1, 2).setHorizontalAlignment('left');

  const prodMatrixRows = [];
  model.domains.forEach((d) => {
    WORKSPACE_PRODUCTS.forEach((p) => {
      const pm = d.products[p.key];
      prodMatrixRows.push([
        d.domainName,
        p.label,
        d.totalUsers,
        d.workspaceActiveUsers28d,
        pm.activeUsers28d,
        pm.pctOfDomainActiveUsers,
        pm.pctOfDomainTotalUsers,
        ''
      ]);
    });
  });

  // Add Organization Total rows per product
  WORKSPACE_PRODUCTS.forEach((p) => {
    const om = model.products[p.key];
    prodMatrixRows.push([
      'ALL DOMAINS (ORG TOTAL)',
      p.label,
      s.totalUsersLicenses,
      s.activeUsers28d,
      om.activeUsers28d,
      om.pctOfActiveUsers,
      om.pctOfTotalUsers,
      ''
    ]);
  });

  const prodMatrixStartRow = rowCursor + 1;
  sheet
    .getRange(prodMatrixStartRow, 1, prodMatrixRows.length, prodMatrixHeaders.length)
    .setValues(prodMatrixRows)
    .setFontSize(9)
    .setVerticalAlignment('middle');

  for (let i = 0; i < prodMatrixRows.length; i++) {
    const r = prodMatrixStartRow + i;
    sheet.setRowHeight(r, 20);
    const isOrgTotal = prodMatrixRows[i][0] === 'ALL DOMAINS (ORG TOTAL)';
    sheet
      .getRange(r, 1, 1, prodMatrixHeaders.length)
      .setBackground(isOrgTotal ? '#E8F0FE' : i % 2 === 0 ? '#FFFFFF' : '#F8F9FA')
      .setFontWeight(isOrgTotal ? 'bold' : 'normal');
    sheet.getRange(r, 3, 1, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 6, 1, 2).setNumberFormat('0.0%').setHorizontalAlignment('right');
    sheet
      .getRange(r, 8)
      .setFormula(`=SPARKLINE(F${r}, {"charttype","bar"; "max",1; "color1","${C.HERO_BLUE}"})`);
  }

  sheet
    .getRange(rowCursor, 1, prodMatrixRows.length + 1, prodMatrixHeaders.length)
    .setBorder(true, true, true, true, true, true, C.BORDER_LIGHT, SpreadsheetApp.BorderStyle.SOLID);

  // --------------------------------------------------------------------------
  // TABLE 3: PER-DOMAIN GOOGLE MEET USAGE (28 DAYS)
  // --------------------------------------------------------------------------
  rowCursor = prodMatrixStartRow + prodMatrixRows.length + 2;
  sheet.setRowHeight(rowCursor, 26);
  sheet
    .getRange(rowCursor, 1, 1, 12)
    .merge()
    .setValue('3. PER-DOMAIN GOOGLE MEET USAGE BREAKDOWN (PAST 28 DAYS — NUMBERS & PERCENTAGES)')
    .setBackground(C.SECTION_HEADER_GREY)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  rowCursor++;
  const meetDomHeaders = [
    'Domain Name',
    'Total Meetings (28d)',
    'Total Meeting Minutes (28d)',
    'Avg Meeting Time (Mins)',
    'Screen Sharing Meetings (#)',
    'Screen Sharing (%)',
    'Recorded Meetings (#)',
    'Recorded (%)',
    'Live Streamed Meetings (#)',
    'Live Streamed (%)',
    'Meetings >100 Participants (#)',
    'Meetings >100 Participants (%)'
  ];
  sheet.setRowHeight(rowCursor, 28);
  sheet
    .getRange(rowCursor, 1, 1, meetDomHeaders.length)
    .setValues([meetDomHeaders])
    .setBackground(C.TABLE_SUBHEADER_BG)
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.getRange(rowCursor, 1).setHorizontalAlignment('left');

  const om = model.meet || {};
  const isMeetGranular = Boolean(om.isGranular);
  const meetDomRows = model.domains.map((d) => [
    d.domainName,
    isMeetGranular ? d.meet.numMeetings : '—',
    isMeetGranular ? d.meet.totalMeetingMinutes : '—',
    isMeetGranular ? d.meet.avgMeetingTimeMinutes : '—',
    isMeetGranular ? d.meet.numScreencastMeetings : '—',
    isMeetGranular ? d.meet.pctScreencastMeetings : '—',
    isMeetGranular ? d.meet.numRecordedMeetings : '—',
    isMeetGranular ? d.meet.pctRecordedMeetings : '—',
    isMeetGranular ? d.meet.numLiveStreamMeetings : '—',
    isMeetGranular ? d.meet.pctLiveStreamMeetings : '—',
    isMeetGranular ? d.meet.numOver100Meetings : '—',
    isMeetGranular ? d.meet.pctOver100Meetings : '—'
  ]);

  meetDomRows.push([
    'ALL DOMAINS (ORGANIZATION TOTAL)',
    om.numMeetings,
    om.totalMeetingMinutes,
    om.avgMeetingTimeMinutes,
    isMeetGranular ? om.numScreencastMeetings : '—',
    isMeetGranular ? om.pctScreencastMeetings : '—',
    isMeetGranular ? om.numRecordedMeetings : '—',
    isMeetGranular ? om.pctRecordedMeetings : '—',
    isMeetGranular ? om.numLiveStreamMeetings : '—',
    isMeetGranular ? om.pctLiveStreamMeetings : '—',
    isMeetGranular ? om.numOver100Meetings : '—',
    isMeetGranular ? om.pctOver100Meetings : '—'
  ]);

  const meetDomStartRow = rowCursor + 1;
  sheet
    .getRange(meetDomStartRow, 1, meetDomRows.length, meetDomHeaders.length)
    .setValues(meetDomRows)
    .setFontSize(9)
    .setVerticalAlignment('middle');

  for (let i = 0; i < meetDomRows.length; i++) {
    const r = meetDomStartRow + i;
    sheet.setRowHeight(r, 22);
    const isTotal = i === meetDomRows.length - 1;
    sheet
      .getRange(r, 1, 1, meetDomHeaders.length)
      .setBackground(isTotal ? '#E8F0FE' : i % 2 === 0 ? '#FFFFFF' : '#F8F9FA')
      .setFontWeight(isTotal ? 'bold' : 'normal');

    for (let c = 0; c < meetDomHeaders.length; c++) {
      const val = meetDomRows[i][c];
      const col = c + 1;
      if (col === 1) {
        sheet.getRange(r, col).setHorizontalAlignment('left');
      } else if (typeof val === 'number') {
        if ([6, 8, 10, 12].includes(col)) {
          sheet.getRange(r, col).setNumberFormat('0.0%').setHorizontalAlignment('right');
        } else {
          sheet.getRange(r, col).setNumberFormat('#,##0').setHorizontalAlignment('right');
        }
      } else {
        sheet.getRange(r, col).setHorizontalAlignment('center');
      }
    }
  }

  sheet
    .getRange(rowCursor, 1, meetDomRows.length + 1, meetDomHeaders.length)
    .setBorder(true, true, true, true, true, true, C.BORDER_LIGHT, SpreadsheetApp.BorderStyle.SOLID);

  if (!isMeetGranular) {
    const fnRow = meetDomStartRow + meetDomRows.length + 1;
    sheet
      .getRange(fnRow, 1, 1, meetDomHeaders.length)
      .merge()
      .setValue('* Note: Per-domain Meet conference breakdowns (screen sharing, recordings, livestreams, and 100+ participants) are populated via the dedicated "📹 Generate Granular Meet Usage Report" menu item.')
      .setFontSize(8)
      .setFontColor(C.TEXT_MUTED)
      .setFontStyle('italic')
      .setVerticalAlignment('middle');
  }

  // Set clean column widths
  const colWidths = [220, 140, 110, 160, 130, 130, 120, 120, 120, 140, 140, 130];
  colWidths.forEach((w, idx) => sheet.setColumnWidth(idx + 1, w));
}

/**
 * Renders the `Data Sources & Audit Log` tab documenting the API endpoints,
 * methodology, percentage denominators, and run telemetry.
 */
function renderMethodologySheet_(sheet, model) {
  const C = REPORT_CONFIG.COLORS;
  sheet.getRange('A1:D40').setFontFamily('Arial');
  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 460);

  sheet.setRowHeight(1, 32);
  sheet
    .getRange('A1:C1')
    .merge()
    .setValue('📋 GOOGLE WORKSPACE USAGE REPORT — METHODOLOGY & API VERIFICATION LOG')
    .setBackground(C.HERO_BLUE)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(12)
    .setVerticalAlignment('middle');

  const rows = [
    ['Property / Metric', 'API Source / Parameter', 'Notes & Calculation Methodology'],
    [
      'Report Date & Window',
      `${model.windowInfo.windowStartDateStr} to ${model.windowInfo.windowEndDateStr} (${model.windowInfo.computationWindowDays} days)`,
      'Anchored to PST (America/Los_Angeles) per Admin SDK Reports API specification.'
    ],
    [
      'Multi-Domain Discovery',
      'AdminDirectory.Customers.get("my_customer"), Domains.list, DomainAliases.list, Users.list',
      `Discovered ${model.domains.length} domain(s): ${model.summary.allDomainNames.join(', ')}`
    ],
    [
      'Total Users (Licenses)',
      'CustomerUsageReports (accounts:*_total_licenses) / AdminLicenseManager / Directory Users',
      'Represents total licenses purchased from Google (with Directory provisioned users also reported).'
    ],
    [
      'Active Users (Workspace All)',
      'Union of 28d Product Active Users, UserUsageReport (accounts:timestamp_last_login), & CustomerUsageReports',
      'Total distinct users who used at least one Google Workspace product in the past 28 days.'
    ],
    [
      'Scorecard Product Adoption %',
      'Product 28d Active Users / Workspace 28d Active Users',
      'Matches the Google Workspace Adoption Scorecard definition ("Active users who have used <Product> in the past 28 days").'
    ],
    [
      'Total License Adoption %',
      'Product 28d Active Users / Total Purchased Licenses (and % of Active Provisioned Users)',
      'Provided alongside Scorecard % so admins see both adoption among active users and adoption across total licenses.'
    ],
    [
      'Gmail Adoption (28d)',
      'UserUsageReport (gmail:timestamp_last_interaction, webmail/imap/pop) + CustomerUsageReports (gmail:num_*_active_users)',
      'Exact 28-day per-user timestamp check reconciled with CustomerUsageReports.'
    ],
    [
      'Calendar Adoption (28d)',
      'Activities.list(applicationName="calendar") + CustomerUsageReports (calendar:num_*_active_users)',
      'Combines 28-day Calendar audit actors per domain with CustomerUsageReports active user counters.'
    ],
    [
      'Drive, Docs, Sheets, Slides (28d)',
      'UserUsageReport (drive:timestamp_last_active_usage, drive:num_google_*) + Activities.list("drive", doc_type) + CustomerUsageReports (drive:num_*_active_users)',
      'Uses updated drive: namespace (legacy docs: namespace was deprecated in May 2018) and Drive audit doc_type.'
    ],
    [
      'Chat Adoption (28d)',
      'CustomerUsageReports (chat:num_28day_engaged_users) + UserUsageReport (chat:num_28day_*) + Activities.list("chat")',
      'Uses native 28-day Chat engaged user metrics (read, sent, or reacted to messages/spaces).'
    ],
    [
      'Meet Adoption & 6 Meet Metrics (28d)',
      'CustomerUsageReports (meet:num_meetings, total_meeting_minutes, num_30day_active_users) + Activities.list("meet")',
      'Groups Meet audit events by conference_id (≥2 endpoints) to count screen sharing, recordings, live streams, and >100 participant meetings.'
    ],
    [
      'Contacts Adoption (28d)',
      'Activities.list(applicationName="contacts") + Activities.list(applicationName="token" for Contacts scopes)',
      'Tracks users with Contacts audit events and Contacts OAuth/client interactions in the 28-day window.'
    ]
  ];

  sheet
    .getRange(3, 1, rows.length, 3)
    .setValues(rows)
    .setFontSize(9)
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet
    .getRange(3, 1, 1, 3)
    .setBackground(C.TABLE_SUBHEADER_BG)
    .setFontWeight('bold');
  sheet
    .getRange(3, 1, rows.length, 3)
    .setBorder(true, true, true, true, true, true, C.BORDER_LIGHT, SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Helper that renders the dark grey section header (`#5E5E5E`) and the 5-segment
 * Google brand color bar (`#C5221F`, `#F29900`, `#1967D2`, `#188038`, `#C5221F`)
 * matching lines 99-104 and 176-181 of `en.ftl`.
 */
function renderSectionHeaderWithGoogleStripe_(sheet, headerRow, titleText) {
  const C = REPORT_CONFIG.COLORS;
  sheet.setRowHeight(headerRow, 22);
  sheet
    .getRange(headerRow, 2, 1, 9)
    .merge()
    .setValue(`  ${titleText}`)
    .setBackground(C.SECTION_HEADER_GREY)
    .setFontColor('#FFFFFF')
    .setFontSize(11)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');

  const stripeRow = headerRow + 1;
  sheet.setRowHeight(stripeRow, 5);
  sheet.getRange(stripeRow, 2, 1, 2).setBackground(C.STRIPE_RED);    // Cols B:C
  sheet.getRange(stripeRow, 4, 1, 2).setBackground(C.STRIPE_YELLOW); // Cols D:E
  sheet.getRange(stripeRow, 6, 1, 2).setBackground(C.STRIPE_BLUE);   // Cols F:G
  sheet.getRange(stripeRow, 8, 1, 2).setBackground(C.STRIPE_GREEN);  // Cols H:I
  sheet.getRange(stripeRow, 10, 1, 1).setBackground(C.STRIPE_RED);   // Col J
}

/**
 * Builds a single-domain Scorecard model from a domain breakdown row so that
 * `renderScorecardSheet_` can render a dedicated visual Scorecard for any domain.
 */
function createSingleDomainScorecardModel_(orgModel, domRow) {
  const products = {};
  WORKSPACE_PRODUCTS.forEach((p) => {
    const dp = domRow.products[p.key];
    products[p.key] = {
      key: p.key,
      label: p.label,
      iconBadge: p.iconBadge,
      badgeColor: p.badgeColor,
      description: p.description,
      activeUsers28d: dp.activeUsers28d,
      pctOfActiveUsers: dp.pctOfDomainActiveUsers,
      pctOfActiveUsersRounded: Math.round(dp.pctOfDomainActiveUsers * 100),
      pctOfTotalUsers: dp.pctOfDomainTotalUsers,
      pctOfActiveProvisioned:
        domRow.activeProvisionedUsers > 0
          ? dp.activeUsers28d / domRow.activeProvisionedUsers
          : dp.pctOfDomainTotalUsers,
      activeUsers7d: '—',
      activeUsers1d: '—'
    };
  });

  return {
    orgInfo: orgModel.orgInfo,
    windowInfo: orgModel.windowInfo,
    summary: {
      primaryDomain: domRow.domainName,
      allDomainNames: [domRow.domainName],
      domainCount: 1,
      activeUsers28d: domRow.workspaceActiveUsers28d,
      totalUsersLicenses: domRow.totalUsers,
      totalAssignedLicenses: domRow.totalUsers,
      totalProvisionedUsers: domRow.totalUsers,
      activeProvisionedUsers: domRow.activeProvisionedUsers,
      suspendedUsers: domRow.suspendedUsers,
      archivedUsers: domRow.archivedUsers,
      workspaceAdoptionPctRounded: Math.round(domRow.workspaceAdoptionPct * 100),
      workspaceAdoptionFraction: domRow.workspaceAdoptionPct,
      totalStorageUsedGb: domRow.storageUsedGb,
      logins1d: '—',
      logins7d: '—',
      logins30d: '—'
    },
    products: products,
    meet: domRow.meet,
    domains: [domRow],
    auditStats: orgModel.auditStats
  };
}

/**
 * ============================================================================
 * GRANULAR GOOGLE MEET USAGE & CONFERENCE SCORECARD REPORT
 * ============================================================================
 * Gathers 28-day daily Meet customer metrics (meetings, duration, calls) and
 * processes Meet activity audit logs to attribute screen sharing, recordings,
 * livestreams, large meetings (>100 participants), and per-domain metrics.
 */
function runGranularMeetReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  toast_(ss, 'Discovering organization customer ID and registered domains...', 'Meet Usage Report');
  const orgInfo = discoverOrganizationAndDomains_();

  toast_(ss, 'Determining 28-day computation window for Google Meet...', 'Meet Usage Report');
  const windowInfo = findLatestAvailableReportDate_();

  toast_(ss, 'Retrieving registered domains inventory...', 'Meet Usage Report');
  const directoryData = fetchUserAndLicenseInventory_(orgInfo, windowInfo);

  toast_(ss, 'Fetching 28-day daily Meet customer metrics (meetings, duration, calls)...', 'Meet Usage Report');
  const customerUsage = fetchCustomerUsageMetrics_(windowInfo, orgInfo, directoryData, {
    includeMeetGranularAudit: true
  });

  toast_(ss, 'Processing Meet activity audit logs (screencasts, recordings, streams, attendees)...', 'Meet Usage Report');
  const meetAuditResult = processMeetActivityAudit28d_(
    windowInfo,
    orgInfo,
    directoryData,
    customerUsage
  );

  toast_(ss, 'Rendering dedicated Meet Usage Deep-Dive sheet...', 'Meet Usage Report');
  const deepDiveSheet = renderMeetDeepDiveSheet_(
    ss,
    orgInfo,
    windowInfo,
    directoryData,
    customerUsage,
    meetAuditResult
  );

  // Update Adoption Scorecard sheet if present
  const scorecardSheet = ss.getSheetByName(REPORT_CONFIG.SHEET_NAMES.SCORECARD);
  if (scorecardSheet) {
    renderMeetScorecardCards_(scorecardSheet, meetAuditResult.orgMeetMetrics, windowInfo.computationWindowDays, 24);
  }

  // Update Multi-Domain Breakdown sheet if present
  const domainSheet = ss.getSheetByName(REPORT_CONFIG.SHEET_NAMES.DOMAIN_BREAKDOWN);
  if (domainSheet) {
    updateMeetTableOnDomainSheet_(domainSheet, directoryData, meetAuditResult);
  }

  if (directoryData && directoryData.userMaskMap) {
    directoryData.userMaskMap.clear();
  }

  ss.setActiveSheet(deepDiveSheet);
  SpreadsheetApp.flush();
  toast_(ss, 'Granular Google Meet Usage Report and Deep-Dive sheet completed!', 'Complete', 8);

  return {
    orgInfo: orgInfo,
    windowInfo: windowInfo,
    meet: meetAuditResult.orgMeetMetrics,
    domainMeet: meetAuditResult.domainMeetMetricsMap
  };
}

/**
 * Renders the 2x3 Meet Usage Scorecard Cards Grid (matching Google Scorecard design).
 */
function renderMeetScorecardCards_(sheet, m, windowDays, startRow) {
  const C = REPORT_CONFIG.COLORS;
  const baseRow = startRow || 24;
  const isGranular = Boolean(m && m.isGranular);
  const hasData = Boolean(m && m.hasData);
  const cardColSets = [
    { iconCol: 2, textStartCol: 3, endCol: 4 }, // B, C..D
    { iconCol: 5, textStartCol: 6, endCol: 7 }, // E, F..G
    { iconCol: 8, textStartCol: 9, endCol: 10 } // H, I..J
  ];

  const meetCardsRow1 = [
    {
      badge: '📹 Meetings',
      badgeColor: '#00897B',
      primaryText: hasData ? formatNumber_(m.numMeetings) : '-',
      secondaryText: hasData
        ? `(${(m.numMeetings / windowDays).toFixed(1)} mtgs/day avg)`
        : '(No data found in 28 days)',
      caption: `Number of meetings in the past ${windowDays} days`
    },
    {
      badge: '⏱️ Duration',
      badgeColor: '#00897B',
      primaryText: hasData && m.avgMeetingTimeMinutes > 0 ? `${formatNumber_(m.avgMeetingTimeMinutes)} min` : (hasData ? '-' : '-'),
      secondaryText: hasData && m.totalMeetingMinutes > 0
        ? `(${formatNumber_(m.totalMeetingMinutes)} total mins)`
        : (hasData ? '(Customer report total)' : '(No data found in 28 days)'),
      caption: `Average meeting time in minutes in the past ${windowDays} days`
    },
    {
      badge: '🖥️ Share',
      badgeColor: '#00897B',
      primaryText: isGranular ? formatNumber_(m.numScreencastMeetings) : '—',
      secondaryText: isGranular
        ? `(${(m.pctScreencastMeetings * 100).toFixed(1)}% of meetings)`
        : "(Run '📹 Granular Meet Report')",
      caption: `Number of meetings that used screen sharing in the past ${windowDays} days`
    }
  ];

  const meetCardsRow2 = [
    {
      badge: '⏺️ REC',
      badgeColor: '#D93025',
      primaryText: isGranular ? formatNumber_(m.numRecordedMeetings) : '—',
      secondaryText: isGranular
        ? `(${(m.pctRecordedMeetings * 100).toFixed(1)}% of meetings)`
        : "(Run '📹 Granular Meet Report')",
      caption: `Number of meetings that were recorded in the past ${windowDays} days`
    },
    {
      badge: '📡 Live',
      badgeColor: '#E37400',
      primaryText: isGranular ? formatNumber_(m.numLiveStreamMeetings) : '—',
      secondaryText: isGranular
        ? `(${(m.pctLiveStreamMeetings * 100).toFixed(1)}% of meetings)`
        : "(Run '📹 Granular Meet Report')",
      caption: `Number of meetings that were live streamed in the past ${windowDays} days`
    },
    {
      badge: '👥 100+',
      badgeColor: '#00897B',
      primaryText: isGranular ? formatNumber_(m.numOver100Meetings) : '—',
      secondaryText: isGranular
        ? `(${(m.pctOver100Meetings * 100).toFixed(1)}% of meetings)`
        : "(Run '📹 Granular Meet Report')",
      caption: `Number of meetings with more than 100 participants in the past ${windowDays} days`
    }
  ];

  [
    { startRow: baseRow, bg: C.CARD_WHITE_BG, cards: meetCardsRow1 },
    { startRow: baseRow + 3, bg: C.CARD_GREY_BG, cards: meetCardsRow2 }
  ].forEach((meetRowGroup) => {
    const r = meetRowGroup.startRow;
    sheet.setRowHeight(r, 36);
    sheet.setRowHeight(r + 1, 16);
    sheet.setRowHeight(r + 2, 30);
    sheet.getRange(r, 2, 3, 9).setBackground(meetRowGroup.bg);

    meetRowGroup.cards.forEach((card, idx) => {
      const cols = cardColSets[idx];
      sheet
        .getRange(r, cols.iconCol, 2, 1)
        .merge()
        .setValue(card.badge)
        .setBackground(card.badgeColor)
        .setFontColor('#FFFFFF')
        .setFontSize(9)
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setWrap(true);

      const fullText = `${card.primaryText}  ${card.secondaryText}`;
      const richMeet = SpreadsheetApp.newRichTextValue()
        .setText(fullText)
        .setTextStyle(
          0,
          card.primaryText.length,
          SpreadsheetApp.newTextStyle()
            .setFontSize(18)
            .setForegroundColor(C.TEXT_SECONDARY)
            .setBold(false)
            .build()
        )
        .setTextStyle(
          card.primaryText.length,
          fullText.length,
          SpreadsheetApp.newTextStyle()
            .setFontSize(10)
            .setForegroundColor(C.HERO_BLUE)
            .setBold(true)
            .build()
        )
        .build();

      sheet
        .getRange(r, cols.textStartCol, 2, 2)
        .merge()
        .setRichTextValue(richMeet)
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle');

      sheet
        .getRange(r + 2, cols.iconCol, 1, 3)
        .merge()
        .setValue(card.caption)
        .setFontSize(9)
        .setFontColor(C.TEXT_PRIMARY)
        .setHorizontalAlignment('left')
        .setVerticalAlignment('top')
        .setWrap(true);
    });
  });
}

/**
 * Updates Table 3 on the `Multi-Domain Breakdown` sheet with granular Meet metrics.
 */
function updateMeetTableOnDomainSheet_(sheet, directoryData, meetAuditResult) {
  const lastRow = sheet.getLastRow() || 100;
  let tableHeaderRow = -1;
  const colA = sheet.getRange(1, 1, Math.min(lastRow, 250), 1).getValues();
  for (let r = 0; r < colA.length; r++) {
    const val = String(colA[r][0] || '');
    if (val.includes('PER-DOMAIN GOOGLE MEET USAGE BREAKDOWN')) {
      tableHeaderRow = r + 1;
      break;
    }
  }

  if (tableHeaderRow === -1) return;

  const dataStartRow = tableHeaderRow + 2;
  const domainsList = Array.from(directoryData.domainStatsMap.values()).sort((a, b) => {
    if (a.domainMeta.isPrimary && !b.domainMeta.isPrimary) return -1;
    if (!a.domainMeta.isPrimary && b.domainMeta.isPrimary) return 1;
    return b.totalUsers - a.totalUsers;
  });

  const updatedRows = domainsList.map((d) => {
    const dMeet = (meetAuditResult.domainMeetMetricsMap && meetAuditResult.domainMeetMetricsMap.get(d.domainName)) || {
      numMeetings: 0,
      totalMeetingMinutes: 0,
      avgMeetingTimeMinutes: 0,
      numScreencastMeetings: 0,
      pctScreencastMeetings: 0,
      numRecordedMeetings: 0,
      pctRecordedMeetings: 0,
      numLiveStreamMeetings: 0,
      pctLiveStreamMeetings: 0,
      numOver100Meetings: 0,
      pctOver100Meetings: 0
    };
    return [
      d.domainName,
      dMeet.numMeetings,
      dMeet.totalMeetingMinutes,
      dMeet.avgMeetingTimeMinutes,
      dMeet.numScreencastMeetings,
      dMeet.pctScreencastMeetings,
      dMeet.numRecordedMeetings,
      dMeet.pctRecordedMeetings,
      dMeet.numLiveStreamMeetings,
      dMeet.pctLiveStreamMeetings,
      dMeet.numOver100Meetings,
      dMeet.pctOver100Meetings
    ];
  });

  const om = meetAuditResult.orgMeetMetrics;
  updatedRows.push([
    'ALL DOMAINS (ORGANIZATION TOTAL)',
    om.numMeetings,
    om.totalMeetingMinutes,
    om.avgMeetingTimeMinutes,
    om.numScreencastMeetings,
    om.pctScreencastMeetings,
    om.numRecordedMeetings,
    om.pctRecordedMeetings,
    om.numLiveStreamMeetings,
    om.pctLiveStreamMeetings,
    om.numOver100Meetings,
    om.pctOver100Meetings
  ]);

  sheet
    .getRange(dataStartRow, 1, updatedRows.length, updatedRows[0].length)
    .setValues(updatedRows);

  for (let i = 0; i < updatedRows.length; i++) {
    const r = dataStartRow + i;
    for (let c = 1; c < updatedRows[i].length; c++) {
      const col = c + 1;
      const val = updatedRows[i][c];
      if (typeof val === 'number') {
        if ([6, 8, 10, 12].includes(col)) {
          sheet.getRange(r, col).setNumberFormat('0.0%').setHorizontalAlignment('right');
        } else {
          sheet.getRange(r, col).setNumberFormat('#,##0').setHorizontalAlignment('right');
        }
      }
    }
  }
}

/**
 * Renders the dedicated `Meet Usage Deep-Dive` sheet.
 */
function renderMeetDeepDiveSheet_(ss, orgInfo, windowInfo, directoryData, customerUsage, meetAuditResult) {
  const C = REPORT_CONFIG.COLORS;
  const sheet = getOrResetSheet_(ss, REPORT_CONFIG.SHEET_NAMES.MEET_DEEP_DIVE, 2);
  sheet.getRange('A1:Z100').setFontFamily('Arial');
  sheet.setHiddenGridlines(true);

  // Set column widths
  const colWidths = [24, 200, 130, 110, 120, 130, 120, 120, 120, 120, 120, 130, 24];
  colWidths.forEach((w, idx) => sheet.setColumnWidth(idx + 1, w));

  // Row 1: Top Hero Banner
  sheet.setRowHeight(1, 38);
  sheet
    .getRange('B1:L1')
    .merge()
    .setValue('📹 GOOGLE MEET USAGE & CONFERENCE SCORECARD — DEEP-DIVE REPORT')
    .setBackground('#00897B')
    .setFontColor('#FFFFFF')
    .setFontSize(13)
    .setFontWeight('bold')
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('center');

  // Metadata summary card (Rows 2..4)
  sheet.setRowHeight(2, 22);
  sheet.setRowHeight(3, 22);
  sheet.setRowHeight(4, 22);

  const m = meetAuditResult.orgMeetMetrics;
  const windowDays = windowInfo.computationWindowDays || 28;

  const totalUsers = directoryData.domainStatsMap
    ? Array.from(directoryData.domainStatsMap.values()).reduce((a, b) => a + b.totalUsers, 0)
    : 0;

  const metaRows = [
    [
      'Organization / Domain:',
      `${orgInfo.primaryDomain} (${orgInfo.customerId})`,
      'Computation Window:',
      `${windowInfo.windowStartDateStr} to ${windowInfo.windowEndDateStr} (${windowDays} days)`
    ],
    [
      'Total Provisioned Users:',
      formatNumber_(totalUsers),
      'Analyzed Meetings (≥2 endpoints):',
      formatNumber_(m.numMeetings)
    ],
    [
      'Total Conference Minutes:',
      `${formatNumber_(m.totalMeetingMinutes)} mins`,
      'Average Meeting Duration:',
      `${formatNumber_(m.avgMeetingTimeMinutes)} min/meeting`
    ]
  ];

  sheet
    .getRange(2, 2, 3, 4)
    .setValues(metaRows)
    .setFontSize(9)
    .setVerticalAlignment('middle');
  sheet.getRange(2, 2, 3, 1).setFontWeight('bold').setFontColor(C.TEXT_MUTED);
  sheet.getRange(2, 4, 3, 1).setFontWeight('bold').setFontColor(C.TEXT_MUTED);
  sheet.getRange(2, 3, 3, 1).setFontWeight('bold').setFontColor(C.TEXT_PRIMARY);
  sheet.getRange(2, 5, 3, 1).setFontWeight('bold').setFontColor(C.TEXT_PRIMARY);

  // Section Header: Scorecard Cards
  renderSectionHeaderWithGoogleStripe_(sheet, 6, 'MEET SCORECARD METRICS (PAST 28 DAYS)');

  // 6 Meet Cards in rows 8..13
  renderMeetScorecardCards_(sheet, m, windowDays, 8);

  // Section Header: Multi-Domain Breakdown
  renderSectionHeaderWithGoogleStripe_(sheet, 15, 'MULTI-DOMAIN MEET CONFERENCE BREAKDOWN');

  // Table header at row 17
  const meetHeaders = [
    'Domain Name',
    'Domain Type',
    'Total Users',
    'Total Meetings (28d)',
    'Total Meeting Minutes',
    'Avg Duration (min)',
    'Screen Sharing (#)',
    'Screen Sharing (%)',
    'Recorded (#)',
    'Recorded (%)',
    'Live Stream (#)',
    'Meetings >100 (%)'
  ];

  sheet.setRowHeight(17, 28);
  sheet
    .getRange(17, 2, 1, meetHeaders.length)
    .setValues([meetHeaders])
    .setBackground(C.TABLE_SUBHEADER_BG)
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  const domainsList = Array.from(directoryData.domainStatsMap.values()).sort((a, b) => {
    if (a.domainMeta.isPrimary && !b.domainMeta.isPrimary) return -1;
    if (!a.domainMeta.isPrimary && b.domainMeta.isPrimary) return 1;
    return b.totalUsers - a.totalUsers;
  });

  const domainRows = domainsList.map((d) => {
    const dMeet = (meetAuditResult.domainMeetMetricsMap && meetAuditResult.domainMeetMetricsMap.get(d.domainName)) || {
      numMeetings: 0,
      totalMeetingMinutes: 0,
      avgMeetingTimeMinutes: 0,
      numScreencastMeetings: 0,
      pctScreencastMeetings: 0,
      numRecordedMeetings: 0,
      pctRecordedMeetings: 0,
      numLiveStreamMeetings: 0,
      pctLiveStreamMeetings: 0,
      numOver100Meetings: 0,
      pctOver100Meetings: 0
    };
    return [
      d.domainName,
      d.domainMeta.domainType || (d.domainMeta.isPrimary ? 'Primary Domain' : 'Secondary Domain'),
      d.totalUsers,
      dMeet.numMeetings,
      dMeet.totalMeetingMinutes,
      dMeet.avgMeetingTimeMinutes,
      dMeet.numScreencastMeetings,
      dMeet.pctScreencastMeetings,
      dMeet.numRecordedMeetings,
      dMeet.pctRecordedMeetings,
      dMeet.numLiveStreamMeetings,
      dMeet.pctOver100Meetings
    ];
  });

  domainRows.push([
    'ALL DOMAINS (ORGANIZATION TOTAL)',
    'All Registered Domains',
    totalUsers,
    m.numMeetings,
    m.totalMeetingMinutes,
    m.avgMeetingTimeMinutes,
    m.numScreencastMeetings,
    m.pctScreencastMeetings,
    m.numRecordedMeetings,
    m.pctRecordedMeetings,
    m.numLiveStreamMeetings,
    m.pctOver100Meetings
  ]);

  sheet
    .getRange(18, 2, domainRows.length, meetHeaders.length)
    .setValues(domainRows)
    .setFontSize(9)
    .setVerticalAlignment('middle');

  for (let i = 0; i < domainRows.length; i++) {
    const r = 18 + i;
    sheet.setRowHeight(r, 22);
    const isTotal = i === domainRows.length - 1;
    sheet
      .getRange(r, 2, 1, meetHeaders.length)
      .setBackground(isTotal ? '#E8F0FE' : i % 2 === 0 ? '#FFFFFF' : '#F8F9FA')
      .setFontWeight(isTotal ? 'bold' : 'normal');

    sheet.getRange(r, 4, 1, 4).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 8).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 9).setNumberFormat('0.0%').setHorizontalAlignment('right');
    sheet.getRange(r, 10).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 11).setNumberFormat('0.0%').setHorizontalAlignment('right');
    sheet.getRange(r, 12).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(r, 13).setNumberFormat('0.0%').setHorizontalAlignment('right');
  }

  sheet
    .getRange(17, 2, domainRows.length + 1, meetHeaders.length)
    .setBorder(true, true, true, true, true, true, C.BORDER_LIGHT, SpreadsheetApp.BorderStyle.SOLID);

  // Methodology notes at the bottom
  const noteRow = 18 + domainRows.length + 2;
  const notes = [
    ['Google Meet Scoring Methodology & Qualification Criteria:'],
    ['• Valid Meetings: Only conferences with at least 2 distinct participant endpoints (endpoints > 1) are counted, excluding 1-person lonely calls.'],
    ['• Screen Sharing: Identified via presentation_started / presentation_stopped events and screencast transmission seconds > 0.'],
    ['• Recordings & Livestreams: Captured via recording_activity, broadcast_activity, and explicit streaming consent audit logs.'],
    ['• Large Meetings (>100): Identified via conferences with more than 100 participant endpoints in the 28-day window.']
  ];
  sheet
    .getRange(noteRow, 2, notes.length, 1)
    .setValues(notes)
    .setFontSize(8)
    .setFontColor(C.TEXT_MUTED);
  sheet.getRange(noteRow, 2).setFontWeight('bold').setFontColor(C.TEXT_PRIMARY);

  return sheet;
}

/**
 * ============================================================================
 * UTILITY & HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Parses a CustomerUsageReports / UserUsageReport `parameters` array into a
 * flat key-value map (`{ "app:param": value }`).
 */
function parseReportParametersList_(paramsList) {
  const map = {};
  if (!Array.isArray(paramsList)) return map;
  paramsList.forEach((p) => {
    if (!p || !p.name) return;
    if (p.intValue !== undefined && p.intValue !== null) {
      map[p.name] = Number(p.intValue);
    } else if (p.datetimeValue !== undefined && p.datetimeValue !== null) {
      map[p.name] = p.datetimeValue;
    } else if (p.stringValue !== undefined && p.stringValue !== null) {
      map[p.name] = p.stringValue;
    } else if (p.boolValue !== undefined && p.boolValue !== null) {
      map[p.name] = Boolean(p.boolValue);
    } else if (p.msgValue !== undefined && p.msgValue !== null) {
      map[p.name] = p.msgValue;
    }
  });
  return map;
}

/**
 * Parses an Activity Audit event's `parameters` array into a flat key-value object.
 */
function parseActivityEventParameters_(paramsList) {
  const map = {};
  if (!Array.isArray(paramsList)) return map;
  paramsList.forEach((p) => {
    if (!p || !p.name) return;
    if (p.value !== undefined && p.value !== null) {
      map[p.name] = p.value;
    } else if (p.intValue !== undefined && p.intValue !== null) {
      map[p.name] = Number(p.intValue);
    } else if (p.boolValue !== undefined && p.boolValue !== null) {
      map[p.name] = Boolean(p.boolValue);
    } else if (Array.isArray(p.multiValue)) {
      map[p.name] = p.multiValue.join(',');
    } else if (Array.isArray(p.multiIntValue)) {
      map[p.name] = p.multiIntValue.join(',');
    }
  });
  return map;
}

/**
 * Resolves a user's email address (converting domain aliases or user aliases
 * to their canonical primary email address in the organization).
 */
function resolveUserEmail_(rawEmail, orgInfo, directoryData) {
  if (!rawEmail || typeof rawEmail !== 'string') return '';
  let email = rawEmail.toLowerCase().trim();
  if (!email.includes('@')) return '';

  if (directoryData && directoryData.usersByEmail && directoryData.usersByEmail.has(email)) {
    return email;
  }

  const parts = email.split('@');
  const localPart = parts[0];
  let domainPart = parts[1];

  // If the email uses a domain alias, rewrite to parent domain
  if (orgInfo && orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(domainPart)) {
    const mappedDomain = orgInfo.aliasToParentDomain.get(domainPart);
    const candidate = `${localPart}@${mappedDomain}`;
    if (directoryData && directoryData.usersByEmail && directoryData.usersByEmail.has(candidate)) {
      return candidate;
    }
    domainPart = mappedDomain;
    email = candidate;
  }

  // Check if the email is a registered user alias in that domain
  if (directoryData && directoryData.domainStatsMap && directoryData.domainStatsMap.has(domainPart)) {
    const dStats = directoryData.domainStatsMap.get(domainPart);
    if (dStats.aliasEmailToPrimary && dStats.aliasEmailToPrimary.has(email)) {
      return dStats.aliasEmailToPrimary.get(email);
    }
  }

  return email;
}

/**
 * Checks whether an email address belongs to one of the organization's domains.
 */
function isInternalOrgEmail_(email, orgInfo, directoryData) {
  if (!email || !email.includes('@')) return false;
  const domain = email.split('@')[1];
  return Boolean(
    (directoryData && directoryData.domainStatsMap && directoryData.domainStatsMap.has(domain)) ||
    (orgInfo && orgInfo.domainsMap && orgInfo.domainsMap.has(domain)) ||
    (orgInfo && orgInfo.aliasToParentDomain && orgInfo.aliasToParentDomain.has(domain))
  );
}

/**
 * Retrieves or creates a user record in `directoryData.usersByEmail` and
 * ensures their domain exists in `directoryData.domainStatsMap`.
 */
function getOrCreateUserRecord_(email, paramMap, orgInfo, directoryData) {
  if (directoryData && directoryData.usersByEmail && directoryData.usersByEmail.has(email)) {
    return directoryData.usersByEmail.get(email);
  }
  const domain =
    (paramMap && paramMap['accounts:domain_name']
      ? String(paramMap['accounts:domain_name']).toLowerCase().trim()
      : '') || email.split('@')[1];

  if (directoryData && directoryData.domainStatsMap && !directoryData.domainStatsMap.has(domain)) {
    const meta = (orgInfo && orgInfo.domainsMap && orgInfo.domainsMap.get(domain)) || {
      domainName: domain,
      isPrimary: Boolean(orgInfo && domain === orgInfo.primaryDomain),
      verified: true,
      domainType: orgInfo && domain === orgInfo.primaryDomain ? 'Primary Domain' : 'Secondary Domain',
      aliases: []
    };
    if (orgInfo && orgInfo.domainsMap) orgInfo.domainsMap.set(domain, meta);
    directoryData.domainStatsMap.set(domain, createEmptyDomainStats_(domain, meta));
  }

  const isSuspended = Boolean(paramMap && paramMap['accounts:is_suspended']);
  const isArchived = Boolean(paramMap && paramMap['accounts:is_archived']);
  const userRec = {
    email: email,
    id: '',
    domain: domain,
    suspended: isSuspended,
    archived: isArchived,
    isActiveAccount: !isSuspended && !isArchived,
    isAdmin: false,
    isDelegatedAdmin: false,
    lastLoginMs: null,
    loggedIn28d: false,
    activeProducts28d: new Set(),
    storageUsedMb: 0
  };
  if (directoryData && directoryData.usersByEmail) {
    directoryData.usersByEmail.set(email, userRec);
  }

  if (directoryData && directoryData.domainStatsMap && directoryData.domainStatsMap.has(domain)) {
    const dStats = directoryData.domainStatsMap.get(domain);
    dStats.totalUsers++;
    if (isSuspended) dStats.suspendedUsers++;
    else if (isArchived) dStats.archivedUsers++;
    else dStats.activeProvisionedUsers++;
  }

  return userRec;
}

/**
 * Marks a user active in a specific product and in overall Workspace (WORKSPACE_ALL).
 */
function markUserProductActive_(userRec, domainStats, productKey) {
  if (userRec) {
    if (userRec.activeProducts28d && userRec.activeProducts28d.add) {
      userRec.activeProducts28d.add(productKey);
    }
  }
  if (domainStats) {
    if (domainStats.productActiveUsersSets && domainStats.productActiveUsersSets[productKey] && domainStats.productActiveUsersSets[productKey].add) {
      domainStats.productActiveUsersSets[productKey].add(userRec ? userRec.email : '');
    } else if (domainStats.productCounts) {
      domainStats.productCounts[productKey] = (domainStats.productCounts[productKey] || 0) + 1;
    }
  }
  markUserActiveInWorkspace_(userRec, domainStats);
}

/**
 * Marks a user active in overall Google Workspace (`WORKSPACE_ALL`) for the 28d window.
 */
function markUserActiveInWorkspace_(userRec, domainStats) {
  if (userRec) {
    userRec.loggedIn28d = true;
  }
  if (domainStats) {
    if (domainStats.activeWorkspaceUsersSet && domainStats.activeWorkspaceUsersSet.add) {
      domainStats.activeWorkspaceUsersSet.add(userRec ? userRec.email : '');
    } else if (domainStats.directWorkspaceActiveCount !== undefined) {
      domainStats.directWorkspaceActiveCount++;
    }
  }
}

/**
 * Parses an Admin SDK timestamp (RFC 3339 string, epoch seconds, epoch ms, or YYYYMMDD)
 * into epoch milliseconds, returning `null` if invalid or zero (1970-01-01).
 */
function parseTimestampToMs_(val) {
  if (val === undefined || val === null || val === '' || val === 0 || val === '0') {
    return null;
  }
  if (typeof val === 'number') {
    if (val <= 0) return null;
    if (val > 1e12) return val; // Epoch ms
    if (val > 1e9) return val * 1000; // Epoch seconds
    // Check YYYYMMDD integer format (e.g. 20260429)
    const s = String(val);
    if (s.length === 8) {
      const iso = `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00Z`;
      const ms = new Date(iso).getTime();
      return isNaN(ms) || ms <= 0 ? null : ms;
    }
    return null;
  }
  const str = String(val).trim();
  if (!str || str.startsWith('1970-01-01')) return null;
  if (/^\d+$/.test(str)) {
    return parseTimestampToMs_(Number(str));
  }
  const ms = new Date(str).getTime();
  return isNaN(ms) || ms <= 0 ? null : ms;
}

/**
 * Checks whether a timestamp value falls within the 28-day computation window.
 */
function isTimestampInWindow_(val, windowInfo) {
  const ms = parseTimestampToMs_(val);
  if (ms === null) return false;
  return ms >= windowInfo.windowStartMs && ms <= windowInfo.windowEndMs;
}

/**
 * Parses a `YYYY-MM-DD` string into a Date object at 12:00 UTC.
 */
function parseIsoDateInTz_(yyyyMmDd) {
  return new Date(`${yyyyMmDd}T12:00:00Z`);
}

/**
 * Apportions an integer `totalDelta` across `shares` using the Largest Remainder
 * method, bounded by per-bucket `capacities`, so that per-domain counts sum
 * exact-to-the-integer to the organization total.
 */
function apportionIntegerDelta_(totalDelta, shares, capacities) {
  const n = shares.length;
  const result = new Array(n).fill(0);
  if (totalDelta <= 0 || n === 0) return result;

  const remList = [];
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const cap = capacities[i] !== undefined ? capacities[i] : totalDelta;
    const exact = totalDelta * (shares[i] || 0);
    const floored = Math.min(cap, Math.floor(exact));
    result[i] = floored;
    allocated += floored;
    remList.push({ idx: i, rem: exact - floored });
  }

  let leftover = totalDelta - allocated;
  remList.sort((a, b) => b.rem - a.rem);
  while (leftover > 0) {
    let progressed = false;
    for (let i = 0; i < n && leftover > 0; i++) {
      const idx = remList[i].idx;
      const cap = capacities[idx] !== undefined ? capacities[idx] : totalDelta;
      if (result[idx] < cap) {
        result[idx]++;
        leftover--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return result;
}

/**
 * Safely converts a value to an integer (defaulting to 0).
 */
function toInt_(val) {
  if (val === undefined || val === null || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : Math.round(n);
}

/**
 * Formats an integer with thousands separators.
 */
function formatNumber_(n) {
  if (n === undefined || n === null || isNaN(Number(n))) return '0';
  return Number(n).toLocaleString('en-US');
}

/**
 * Optional fallback to count assigned licenses via Enterprise License Manager API
 * if `CustomerUsageReports` license counters are not populated.
 */
function tryCountAssignedWorkspaceLicenses_(customerId) {
  const productIds = ['Google-Apps', '101031', '101034'];
  const licensedUsers = new Set();
  productIds.forEach((productId) => {
    let pageToken = null;
    do {
      try {
        const opts = { maxResults: 1000 };
        if (pageToken) opts.pageToken = pageToken;
        const resp = AdminLicenseManager.LicenseAssignments.listForProduct(
          productId,
          customerId || 'my_customer',
          opts
        );
        const items = (resp && resp.items) || [];
        items.forEach((item) => {
          if (item.userId) licensedUsers.add(item.userId.toLowerCase());
        });
        pageToken = resp ? resp.nextPageToken : null;
      } catch (e) {
        pageToken = null;
      }
    } while (pageToken);
  });
  return licensedUsers.size;
}

/**
 * Executes an Admin SDK API call with exponential backoff retry on transient
 * quota / rate-limit errors (429 / 500 / 503).
 */
function executeWithRetry_(fn) {
  let attempt = 0;
  let delayMs = REPORT_CONFIG.RETRY_INITIAL_DELAY_MS;
  while (true) {
    try {
      return fn();
    } catch (e) {
      attempt++;
      const msg = String(e && e.message ? e.message : e).toLowerCase();
      const isRetryable =
        msg.includes('rate limit') ||
        msg.includes('quota') ||
        msg.includes('429') ||
        msg.includes('500') ||
        msg.includes('503') ||
        msg.includes('backend error') ||
        msg.includes('service invoked too many times');
      if (!isRetryable || attempt >= REPORT_CONFIG.RETRY_MAX_ATTEMPTS) {
        throw e;
      }
      Utilities.sleep(delayMs);
      delayMs *= 2;
    }
  }
}

/**
 * Gets an existing sheet by name (clearing its contents/formats) or inserts a new sheet.
 */
function getOrResetSheet_(ss, sheetName, index) {
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    sheet.clear();
    sheet.clearFormats();
    sheet.clearConditionalFormatRules();
  } else {
    sheet = ss.insertSheet(sheetName, index);
  }
  return sheet;
}

/**
 * Displays a non-blocking toast notification in Google Sheets if available.
 */
function toast_(ss, message, title, timeoutSeconds) {
  try {
    if (ss && typeof ss.toast === 'function') {
      ss.toast(message, title || 'Workspace Usage', timeoutSeconds || 5);
    }
  } catch (e) {
    // Ignore when running from time-driven trigger or headless test
  }
}
