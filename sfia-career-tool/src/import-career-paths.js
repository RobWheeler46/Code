const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('./db');

// One-off import: replaces the fictional placeholder demo content (role families, SFIA skills,
// role profiles, career pathways, learning resources) with real data from the user's own
// EngineeringCareerPathsV3.xlsx. SFIA skill codes are real; skill names are deliberately left as
// the code itself (no invented official SFIA names/descriptions - see README).

const TIME_HORIZON_RANK = {
  'Days to weeks': 1,
  'Weeks to months': 2,
  'Quarters': 3,
  '6-12 months': 4,
  '1-2 years': 5,
  '2-3 years': 6,
  '3-5+ years': 7
};

const ROLES = [
  {
    title: 'Associate Software Engineer', track: 'Software',
    scope: 'Individual tasks and small features', timeHorizon: 'Days to weeks',
    impact: 'Reliable task completion and learning velocity',
    techFocus: 'Learning language fundamentals, tools, and team processes',
    leadership: 'Follows instructions, seeks guidance, self-management',
    people: 'Learns from others, participates in team activities',
    external: 'Learns industry basics, follows internal standards',
    dei: 'Inclusive collaboration: respects diverse perspectives, learns about unconscious bias',
    skillsDev: 'Self-development: actively learns new skills, seeks feedback, completes training',
    workforce: 'Talent pipeline: demonstrates growth potential, good attendance and engagement',
    skillsRaw: 'PROG (L2), TEST (L2), DESN (L1), BUAN (L1)', totalPoints: 6
  },
  {
    title: 'Associate Platform Engineer', track: 'Platform',
    scope: 'Individual tasks and small features', timeHorizon: 'Days to weeks',
    impact: 'Reliable task completion and learning velocity',
    techFocus: 'Learning language fundamentals, tools, and team processes',
    leadership: 'Follows instructions, seeks guidance, self-management',
    people: 'Learns from others, participates in team activities',
    external: 'Learns industry basics, follows internal standards',
    dei: 'Inclusive collaboration: respects diverse perspectives, learns about unconscious bias',
    skillsDev: 'Self-development: actively learns new skills, seeks feedback, completes training',
    workforce: 'Talent pipeline: demonstrates growth potential, good attendance and engagement',
    skillsRaw: 'ASUP(L2),CFMG(L2),TEST(L2), BUAN (L1)', totalPoints: 7
  },
  {
    title: 'Associate Cloud Engineer', track: 'Cloud',
    scope: 'Individual cloud resources and basic services', timeHorizon: 'Days to weeks',
    impact: 'Reliable provisioning and basic operations',
    techFocus: 'Learning cloud fundamentals, IaaS, basic networking',
    leadership: 'Follows runbooks, seeks guidance, follows security protocols',
    people: 'Learns from senior team members, participates in team operations',
    external: 'Learns cloud provider basics, follows cloud best practices',
    dei: 'Inclusive operations: follows diverse team protocols, psychologically safe environment',
    skillsDev: 'Cloud foundation: builds cloud fundamentals, security best practices',
    workforce: 'Workforce readiness: reliable work habits, learning agility',
    skillsRaw: 'USUP (L2), SCTY (L2), NTDS (L2), PBMG (L1)', totalPoints: 7
  },
  {
    title: 'Associate Data Engineer', track: 'Data',
    scope: 'Individual data pipelines and datasets', timeHorizon: 'Days to weeks',
    impact: 'Reliable data processing and quality checks',
    techFocus: 'Learning data fundamentals, ETL tools, basic SQL',
    leadership: 'Follows instructions, seeks guidance, follows data governance',
    people: 'Learns from senior team members, participates in team data ops',
    external: 'Learns data tools and platforms, follows data standards',
    dei: 'Inclusive data practices: considers diverse data sources and biases',
    skillsDev: 'Data foundation: learns data modeling, quality frameworks',
    workforce: 'Data talent pipeline: shows aptitude for data engineering',
    skillsRaw: 'DATM (L2), DBDS (L2), PROG (L2), QUMT (L1)', totalPoints: 7
  },
  {
    title: 'Associate Security Engineer', track: 'Security',
    scope: 'Individual security controls and monitoring', timeHorizon: 'Days to weeks',
    impact: 'Reliable security scanning and basic threat detection',
    techFocus: 'Learning security fundamentals, vulnerability assessment, basic controls',
    leadership: 'Follows security protocols, seeks guidance, follows compliance',
    people: 'Learns from security team, participates in security reviews',
    external: 'Learns security frameworks, follows security standards',
    dei: 'Inclusive security: considers diverse user needs in security design',
    skillsDev: 'Security foundation: learns security frameworks, compliance',
    workforce: 'Security talent pipeline: demonstrates security mindset',
    skillsRaw: 'SCTY (L2), VUIM (L2), AUTH (L2), OPSG (L1)', totalPoints: 7
  },
  {
    title: 'Associate AI/ML Engineer', track: 'AI/ML',
    scope: 'Individual models and data preprocessing', timeHorizon: 'Days to weeks',
    impact: 'Reliable model training and data preparation',
    techFocus: 'Learning ML fundamentals, basic algorithms, data preprocessing',
    leadership: 'Follows ML workflows, seeks guidance, follows model governance',
    people: 'Learns from senior ML engineers, participates in model reviews',
    external: 'Learns ML frameworks, follows AI ethics guidelines',
    dei: 'Ethical AI awareness: learns about bias in AI, inclusive data practices',
    skillsDev: 'AI foundation: learns ML algorithms, model development',
    workforce: 'AI talent pipeline: shows potential in AI development',
    skillsRaw: 'INAN (L2), PROG (L2), DATM (L2), MLEN (L1)', totalPoints: 7
  },
  {
    title: 'Data Engineer', track: 'Data',
    scope: 'Data pipelines and databases within a domain', timeHorizon: 'Weeks to months',
    impact: 'Reliable data delivery and quality assurance',
    techFocus: 'Data modeling, ETL optimization, data quality frameworks',
    leadership: 'Peer collaboration, data quality advocacy, proactive improvement',
    people: 'Mentors juniors, improves data documentation',
    external: 'Stays current with data technologies and best practices',
    dei: 'Inclusive data design: considers diverse data sources and user needs',
    skillsDev: 'Data engineering skills: ETL optimization, data modeling',
    workforce: 'Data team capacity: reliable pipeline delivery, supports data consumers',
    skillsRaw: 'DATM (L3), DBDS (L3), PROG (L3), QUMT (L2)', totalPoints: 11
  },
  {
    title: 'Security Engineer', track: 'Security',
    scope: 'Security systems and controls within a domain', timeHorizon: 'Weeks to months',
    impact: 'Effective security controls and incident response',
    techFocus: 'Security architecture, vulnerability management, access controls',
    leadership: 'Peer collaboration, security advocacy, proactive threat hunting',
    people: 'Mentors juniors, improves security documentation',
    external: 'Stays current with security threats and defenses',
    dei: 'Inclusive security design: considers diverse user populations in security controls',
    skillsDev: 'Security engineering: vulnerability management, access controls',
    workforce: 'Security operations: maintains security controls, supports incident response',
    skillsRaw: 'SCTY (L3), VUIM (L3), AUTH (L3), OPSG (L2)', totalPoints: 11
  },
  {
    title: 'AI/ML Engineer', track: 'AI/ML',
    scope: 'ML pipelines and models within a domain', timeHorizon: 'Weeks to months',
    impact: 'Effective model deployment and performance',
    techFocus: 'Machine learning, feature engineering, model optimization',
    leadership: 'Peer collaboration, ML best practices, proactive experimentation',
    people: 'Mentors juniors, improves ML documentation',
    external: 'Stays current with AI research and frameworks',
    dei: 'Ethical AI implementation: tests for bias, considers diverse model impacts',
    skillsDev: 'ML engineering: feature engineering, model optimization',
    workforce: 'AI team capacity: reliable model development and deployment',
    skillsRaw: 'MLEN (L3), PROG (L3), INAN (L3), DATM (L2)', totalPoints: 11
  },
  {
    title: 'Platform Engineer', track: 'Platform',
    scope: 'Features and components within a single team', timeHorizon: 'Weeks to months',
    impact: 'Independent feature delivery and team collaboration',
    techFocus: 'Mastering tech stack, design patterns, testing strategies',
    leadership: 'Peer collaboration, knowledge sharing, proactive contribution',
    people: 'Mentors juniors, improves team documentation',
    external: 'Stays current with relevant technologies and frameworks',
    dei: 'Mentorship: supports junior engineers from diverse backgrounds, inclusive code reviews',
    skillsDev: 'Skill expansion: develops full-stack capabilities, testing expertise',
    workforce: 'Team capacity: reliably delivers features, supports team velocity',
    skillsRaw: 'PORT(L3),SYAS(L3),ASUP(L4), BUAN (L2)', totalPoints: 12
  },
  {
    title: 'Software Engineer', track: 'Software',
    scope: 'Features and components within a single team', timeHorizon: 'Weeks to months',
    impact: 'Independent feature delivery and team collaboration',
    techFocus: 'Mastering tech stack, design patterns, testing strategies',
    leadership: 'Peer collaboration, knowledge sharing, proactive contribution',
    people: 'Mentors juniors, improves team documentation',
    external: 'Stays current with relevant technologies and frameworks',
    dei: 'Mentorship: supports junior engineers from diverse backgrounds, inclusive code reviews',
    skillsDev: 'Skill expansion: develops full-stack capabilities, testing expertise',
    workforce: 'Team capacity: reliably delivers features, supports team velocity',
    skillsRaw: 'PROG (L3), DESN (L2), TEST (L3), DBDS (L2), BUAN (L2)', totalPoints: 12
  },
  {
    title: 'Cloud Engineer', track: 'Cloud',
    scope: 'Cloud services and components within a single environment', timeHorizon: 'Weeks to months',
    impact: 'Independent service deployment and operational reliability',
    techFocus: 'Mastering cloud services, automation scripts, cost optimization',
    leadership: 'Peer collaboration, knowledge sharing, proactive improvement',
    people: 'Mentors juniors, improves cloud documentation',
    external: 'Stays current with cloud provider updates and new services',
    dei: 'Knowledge sharing: documents cloud patterns accessibly, mentors diverse team members',
    skillsDev: 'Automation skills: develops infrastructure as code, cost optimization',
    workforce: 'Operational excellence: maintains cloud reliability, supports team operations',
    skillsRaw: 'USUP (L3), SCTY (L3), NTDS (L3), PBMG (L2), ASMG (L2)', totalPoints: 13
  },
  {
    title: 'Senior Data Engineer', track: 'Data',
    scope: 'Data platforms and cross-domain pipelines', timeHorizon: 'Quarters',
    impact: 'Data platform reliability, governance, and business insights',
    techFocus: 'Data architecture, real-time processing, data governance',
    leadership: 'Technical mentorship, data strategy, cross-team collaboration',
    people: 'Mentors mid-level engineers, designs data training',
    external: 'Evaluates new data technologies, contributes to data communities',
    dei: 'Inclusive data governance: ensures data represents diverse perspectives',
    skillsDev: 'Data architecture: develops data platform design, governance skills',
    workforce: 'Data capability: builds platforms that serve diverse business needs',
    skillsRaw: 'DATM (L4), DBDS (L4), ARCH (L3), QUMT (L3)', totalPoints: 14
  },
  {
    title: 'Senior Security Engineer', track: 'Security',
    scope: 'Security programs and enterprise controls', timeHorizon: 'Quarters',
    impact: 'Security program effectiveness and risk reduction',
    techFocus: 'Security architecture, threat modeling, security automation',
    leadership: 'Technical mentorship, security strategy, incident leadership',
    people: 'Mentors mid-level engineers, designs security training',
    external: 'Evaluates new security technologies, contributes to security communities',
    dei: 'Inclusive security programs: designs security for diverse user needs',
    skillsDev: 'Security architecture: develops threat modeling, automation skills',
    workforce: 'Security capability: builds security programs for entire organization',
    skillsRaw: 'SCTY (L4), OPSG (L4), ARCH (L3), VUIM (L3)', totalPoints: 14
  },
  {
    title: 'Senior AI/ML Engineer', track: 'AI/ML',
    scope: 'ML platforms and cross-domain models', timeHorizon: 'Quarters',
    impact: 'ML platform reliability and business impact through AI',
    techFocus: 'ML architecture, model governance, MLOps',
    leadership: 'Technical mentorship, AI strategy, cross-team collaboration',
    people: 'Mentors mid-level engineers, designs AI training',
    external: 'Evaluates new AI technologies, contributes to AI communities',
    dei: 'Ethical AI leadership: implements bias testing, diverse model validation',
    skillsDev: 'ML architecture: develops MLOps, model governance skills',
    workforce: 'AI capability: builds platforms for diverse AI applications',
    skillsRaw: 'MLEN (L4), ARCH (L3), PROG (L4), INAN (L4)', totalPoints: 15
  },
  {
    title: 'Senior Platform Engineer', track: 'Platform',
    scope: 'Systems and services across a team or multiple teams', timeHorizon: 'Quarters',
    impact: 'System ownership, technical leadership, mentoring impact',
    techFocus: 'System architecture, cross-team integration, technical debt management',
    leadership: 'Technical mentorship, design leadership, process improvement',
    people: 'Mentors mid-level engineers, interviews candidates, improves hiring',
    external: 'Evaluates new technologies, contributes to open source occasionally',
    dei: 'Inclusive technical leadership: ensures design discussions include all voices, mentors underrepresented engineers',
    skillsDev: 'Cross-functional skills: develops architecture and leadership capabilities',
    workforce: 'Talent development: interviews candidates, improves hiring processes, mentors multiple engineers',
    skillsRaw: 'SADM(L4),DESN(L4),RELM(L5), BUAN (L3)', totalPoints: 16
  },
  {
    title: 'Senior Cloud Engineer', track: 'Cloud',
    scope: 'Cloud platforms and multi-service architectures', timeHorizon: 'Quarters',
    impact: 'Platform reliability, cost optimization, cross-team enablement',
    techFocus: 'Cloud architecture, infrastructure as code, security governance',
    leadership: 'Technical mentorship, design leadership, operational excellence',
    people: 'Mentors mid-level engineers, designs cloud training, improves cloud hiring',
    external: 'Evaluates new cloud services, contributes to cloud communities',
    dei: 'Inclusive platform design: designs accessible cloud platforms, mentors diverse engineers',
    skillsDev: 'Architecture skills: develops multi-cloud expertise, security governance',
    workforce: 'Platform enablement: builds platforms that enable diverse team productivity',
    skillsRaw: 'SCTY (L4), PBMG (L4), ASMG (L3), ARCH (L3), INOV (L3)', totalPoints: 17
  },
  {
    title: 'Senior Software Engineer', track: 'Software',
    scope: 'Systems and services across a team or multiple teams', timeHorizon: 'Quarters',
    impact: 'System ownership, technical leadership, mentoring impact',
    techFocus: 'System architecture, cross-team integration, technical debt management',
    leadership: 'Technical mentorship, design leadership, process improvement',
    people: 'Mentors mid-level engineers, interviews candidates, improves hiring',
    external: 'Evaluates new technologies, contributes to open source occasionally',
    dei: 'Inclusive technical leadership: ensures design discussions include all voices, mentors underrepresented engineers',
    skillsDev: 'Cross-functional skills: develops architecture and leadership capabilities',
    workforce: 'Talent development: interviews candidates, improves hiring processes, mentors multiple engineers',
    skillsRaw: 'PROG (L4), DESN (L4), TECH (L4), LEDA (L3), BUAN (L3)', totalPoints: 18
  },
  {
    title: 'Data Architect', track: 'Data',
    scope: 'Enterprise data strategy and governance', timeHorizon: '6-12 months',
    impact: 'Data-driven decision making and data product enablement',
    techFocus: 'Data mesh/lakehouse architecture, data governance, data quality',
    leadership: 'Influence without authority, data evangelism, standards development',
    people: 'Mentors senior data engineers, develops data talent',
    external: 'Engages with data platform vendors, contributes to data standards',
    dei: 'Inclusive data strategy: ensures data accessibility across organization',
    skillsDev: 'Data strategy: develops enterprise data architecture, governance',
    workforce: 'Data workforce: builds data capabilities across business units',
    skillsRaw: 'ARCH (L5), DATM (L5), GOVN (L4), QUMT (L4)', totalPoints: 18
  },
  {
    title: 'Security Architect', track: 'Security',
    scope: 'Enterprise security strategy and architecture', timeHorizon: '6-12 months',
    impact: 'Security posture improvement and risk management',
    techFocus: 'Zero trust architecture, security frameworks, compliance strategy',
    leadership: 'Influence without authority, security evangelism, risk leadership',
    people: 'Mentors senior security engineers, develops security talent',
    external: 'Engages with security vendors, contributes to security standards',
    dei: 'Inclusive security architecture: designs security for diverse global workforce',
    skillsDev: 'Security strategy: develops enterprise security architecture',
    workforce: 'Security workforce: builds security capabilities across organization',
    skillsRaw: 'ARCH (L5), SCTY (L5), GOVN (L4), OPSG (L4)', totalPoints: 18
  },
  {
    title: 'AI/ML Architect', track: 'AI/ML',
    scope: 'Enterprise AI strategy and ML platform', timeHorizon: '6-12 months',
    impact: 'AI-enabled business capabilities and innovation',
    techFocus: 'MLOps architecture, AI governance, model lifecycle management',
    leadership: 'Influence without authority, AI evangelism, ethical AI advocacy',
    people: 'Mentors senior AI engineers, develops AI talent',
    external: 'Engages with AI platform vendors, contributes to AI standards',
    dei: 'Ethical AI architecture: implements bias detection, diverse model training',
    skillsDev: 'AI strategy: develops enterprise AI architecture, governance',
    workforce: 'AI workforce: builds AI capabilities across business functions',
    skillsRaw: 'ARCH (L5), MLEN (L5), GOVN (L4), INAN (L4)', totalPoints: 18
  },
  {
    title: 'Engineering Manager', track: 'Management',
    scope: 'Multidisciplinary team (mixed engineering roles)', timeHorizon: 'Quarters',
    impact: 'Team health, delivery success, individual growth across disciplines',
    techFocus: 'Technical oversight, architecture review, cross-domain risk management',
    leadership: 'Servant leadership, coaching, stakeholder management, talent development',
    people: 'Hiring and developing mixed-skill teams; career growth for all engineers',
    external: 'Builds diverse talent pipelines; manages vendor relationships for team needs',
    dei: 'Inclusive team leadership: builds diverse teams, fosters inclusive culture, addresses bias in processes',
    skillsDev: 'Team development: creates individual development plans, identifies skill gaps',
    workforce: 'Workforce planning: manages team composition, succession planning, performance management',
    skillsRaw: 'PEMT (L5), RESC (L5), LEDA (L4), STPL (L4)', totalPoints: 18
  },
  {
    title: 'Principal Data Architect', track: 'Data',
    scope: 'Organization-wide data transformation', timeHorizon: '1-2 years',
    impact: 'Data culture transformation and data monetization',
    techFocus: 'Data product strategy, advanced analytics, data marketplace',
    leadership: 'Thought leadership, strategic influence, data transformation',
    people: 'Develops data architects, shapes data career paths',
    external: 'Data industry leadership, academic research collaboration',
    dei: 'Inclusive data innovation: ensures data products serve diverse markets',
    skillsDev: 'Data innovation: drives data product strategy, advanced analytics',
    workforce: 'Data workforce: transforms data capabilities across organization',
    skillsRaw: 'ARCH (L6), DATM (L6), INOV (L5), BUSA (L4)', totalPoints: 21
  },
  {
    title: 'Principal Security Architect', track: 'Security',
    scope: 'Organization-wide security transformation', timeHorizon: '1-2 years',
    impact: 'Security culture and cyber resilience',
    techFocus: 'Cyber defense strategy, security automation, threat intelligence',
    leadership: 'Thought leadership, strategic influence, security transformation',
    people: 'Develops security architects, shapes security career paths',
    external: 'Security industry leadership, threat intelligence sharing',
    dei: 'Global security inclusion: designs security for diverse international operations',
    skillsDev: 'Security innovation: drives cyber defense strategy, automation',
    workforce: 'Security workforce: transforms security capabilities across organization',
    skillsRaw: 'ARCH (L6), SCTY (L6), INOV (L5), BUSA (L4)', totalPoints: 21
  },
  {
    title: 'Principal AI/ML Architect', track: 'AI/ML',
    scope: 'Organization-wide AI transformation', timeHorizon: '1-2 years',
    impact: 'AI-first strategy and competitive advantage',
    techFocus: 'AI strategy, generative AI, responsible AI framework',
    leadership: 'Thought leadership, strategic influence, AI transformation',
    people: 'Develops AI architects, shapes AI career paths',
    external: 'AI industry leadership, AI ethics standards development',
    dei: 'Ethical AI transformation: implements responsible AI across organization',
    skillsDev: 'AI innovation: drives AI strategy, generative AI capabilities',
    workforce: 'AI workforce: transforms AI capabilities across business units',
    skillsRaw: 'ARCH (L6), MLEN (L6), INOV (L5), BUSA (L4)', totalPoints: 21
  },
  {
    title: 'Staff Software Engineer', track: 'Software',
    scope: 'Business domains and cross-cutting concerns', timeHorizon: '6-12 months',
    impact: 'Solving systemic problems, elevating engineering practices across teams',
    techFocus: 'Cross-system architecture, technical governance, platform strategy',
    leadership: 'Influence without authority, technical evangelism, consensus building',
    people: 'Mentors senior engineers, develops technical leaders, shapes hiring bars',
    external: 'Engages with vendor technical teams, represents company in technical communities',
    dei: 'DEI technical advocacy: champions inclusive technical practices, ensures systems serve diverse users',
    skillsDev: 'Community building: develops teaching and mentoring capabilities at scale',
    workforce: 'Workforce strategy: shapes technical hiring standards, develops talent assessment methods',
    skillsRaw: 'TECH (L5), DESN (L5), ARCH (L4), INOV (L4), LEDA (L4)', totalPoints: 22
  },
  {
    title: 'Senior Engineering Manager', track: 'Management',
    scope: 'Multiple diverse teams (across technology domains)', timeHorizon: '1-2 years',
    impact: 'Organizational effectiveness, cross-team strategy, business domain delivery',
    techFocus: 'Technical strategy alignment, portfolio health, architecture governance across domains',
    leadership: 'Organizational leadership, change management, executive communication',
    people: 'Manager development, organizational design, talent strategy across domains',
    external: 'Strategic vendor/partner management; industry peer networking',
    dei: 'Organizational DEI strategy: implements DEI initiatives, tracks diversity metrics, ensures equitable processes',
    skillsDev: 'Organizational capability: develops training programs, career path frameworks',
    workforce: 'Strategic workforce planning: manages department headcount, skills forecasting, talent mobility',
    skillsRaw: 'PEMT (L6), RESC (L6), RLMT (L5), STRP (L5)', totalPoints: 22
  },
  {
    title: 'Staff Platform Engineer', track: 'Platform',
    scope: 'Business domains and cross-cutting concerns', timeHorizon: '6-12 months',
    impact: 'Solving systemic problems, elevating engineering practices across teams',
    techFocus: 'Cross-system architecture, technical governance, platform strategy',
    leadership: 'Influence without authority, technical evangelism, consensus building',
    people: 'Mentors senior engineers, develops technical leaders, shapes hiring bars',
    external: 'Engages with vendor technical teams, represents company in technical communities',
    dei: 'DEI technical advocacy: champions inclusive technical practices, ensures systems serve diverse users',
    skillsDev: 'Community building: develops teaching and mentoring capabilities at scale',
    workforce: 'Workforce strategy: shapes technical hiring standards, develops talent assessment methods',
    skillsRaw: 'PLMT(L5),STAD(L5),RLMT(L6), BUAN (L3), INOV (L4)', totalPoints: 23
  },
  {
    title: 'Cloud Architect', track: 'Cloud',
    scope: 'Enterprise cloud strategy and multi-cloud domains', timeHorizon: '6-12 months',
    impact: 'Standardizing cloud patterns, optimizing cloud spend, enabling developer velocity',
    techFocus: 'Multi-cloud architecture, cloud governance, platform engineering',
    leadership: 'Influence without authority, cloud evangelism, standards development',
    people: 'Mentors senior cloud engineers, develops cloud center of excellence',
    external: 'Engages with cloud provider architects, contributes to cloud standards',
    dei: 'Accessible architecture: designs cloud solutions that serve diverse user needs and abilities',
    skillsDev: 'Strategic skills: develops business alignment and executive communication',
    workforce: 'Capability scaling: creates cloud patterns that enable entire organization',
    skillsRaw: 'ARCH (L5), PBMG (L5), SCTY (L5), ASMG (L4), INOV (L4)', totalPoints: 23
  },
  {
    title: 'Principal Software Engineer', track: 'Software',
    scope: 'Division-wide platforms and strategic technical investments', timeHorizon: '1-2 years',
    impact: 'Setting technical strategy, organizational technical excellence, industry influence',
    techFocus: 'Multi-year technical vision, bet-the-business architecture, innovation pipeline',
    leadership: 'Thought leadership, strategic influence, organizational change leadership',
    people: 'Develops staff engineers, shapes technical career paths, advises on senior hiring',
    external: 'Industry standards participation, open source leadership, technical advisory boards',
    dei: 'Industry DEI leadership: represents company in diverse forums, mentors across organizations',
    skillsDev: 'Thought leadership: develops industry influence, patent development, standards work',
    workforce: 'Talent ecosystem: shapes industry talent pipelines, academic partnerships',
    skillsRaw: 'TECH (L6), ARCH (L5), INOV (L5), STPL (L5), LEDA (L5)', totalPoints: 26
  },
  {
    title: 'Head of Engineering', track: 'Management',
    scope: 'Large engineering organization or major business unit', timeHorizon: '2-3 years',
    impact: 'Business unit technology strategy, major program delivery, organizational scaling',
    techFocus: 'Technology investment strategy, platform scalability, delivery excellence',
    leadership: 'Executive leadership, business partnership, organizational design',
    people: 'Senior leadership development, organizational culture, executive hiring',
    external: 'Industry representation, major vendor partnerships, customer engagement',
    dei: 'Executive DEI leadership: sets DEI strategy for business unit, ensures inclusive culture',
    skillsDev: 'Business unit capability: oversees capability development for major domain',
    workforce: 'Workforce strategy: designs organization structure, talent strategy for business unit',
    skillsRaw: 'PEMT (L7), STRP (L7), PORT (L6), RLMT (L6)', totalPoints: 26
  },
  {
    title: 'Principal Cloud Architect', track: 'Cloud',
    scope: 'Organization-wide cloud transformation and strategy', timeHorizon: '1-2 years',
    impact: 'Cloud-first strategy, cost transformation, business continuity through cloud',
    techFocus: 'Cloud-native transformation, financial operations (FinOps), disaster recovery strategy',
    leadership: 'Thought leadership, strategic influence, cloud transformation leadership',
    people: 'Develops cloud architects, shapes cloud career paths, advises on cloud talent strategy',
    external: 'Cloud provider executive relationships, industry cloud advisory boards',
    dei: 'Inclusive technology standards: develops cloud standards that consider diverse global needs',
    skillsDev: 'Innovation leadership: drives cloud research, develops new capabilities',
    workforce: 'Workforce transformation: leads cloud skill transformation across organization',
    skillsRaw: 'ARCH (L6), PBMG (L6), SCTY (L6), ASMG (L5), BUSA (L4)', totalPoints: 27
  },
  {
    title: 'Distinguished Engineer', track: 'Technical',
    scope: 'Enterprise-wide technical synthesis and industry impact', timeHorizon: '3-5+ years',
    impact: 'Orchestrating technological synergies for new business models and market transformation',
    techFocus: 'Cross-domain synthesis, technology foresight, strategic technical due diligence',
    leadership: 'Visionary integrator, executive influence, industry thought leadership',
    people: 'Cultivates principal engineers across all domains, advises C-suite on technical talent',
    external: 'Represents holistic technology brand, industry keynote speaking, standards influence',
    dei: 'Systems-level DEI advocacy: ensures overall tech strategy promotes equity and ethical outcomes',
    skillsDev: 'Ecosystem strategy: develops partnerships, research agendas, acquisition targets',
    workforce: 'Defines future technical roles: shapes long-term capability map for entire organization',
    skillsRaw: 'STRT (L7), INOV (L7), TECH (L6), BUSA (L6), RLMT (L6)', totalPoints: 32
  }
];

function parseSkills(raw) {
  return raw.split(',').map(part => {
    const m = part.trim().match(/^([A-Z]+)\s*\(L(\d)\)$/);
    if (!m) throw new Error(`Could not parse skill entry: "${part}"`);
    return { code: m[1], level: Number(m[2]) };
  });
}

function deriveSeniority(title) {
  if (title === 'Distinguished Engineer') return 'Distinguished';
  if (title === 'Head of Engineering') return 'Head of Engineering';
  if (title === 'Engineering Manager') return 'Manager';
  if (/^Senior /.test(title)) return 'Senior';
  if (/^Staff /.test(title)) return 'Staff';
  if (/^Principal /.test(title)) return 'Principal';
  if (/^Associate /.test(title)) return 'Associate';
  if (/Architect$/.test(title)) return 'Architect';
  return 'Engineer';
}

function wipeContentTables() {
  const tables = [
    'usage_events', 'content_versions',
    'role_profile_skills', 'career_pathway_connections', 'career_pathway_roles', 'career_pathways',
    'learning_resource_skills', 'learning_resources',
    'sfia_skill_level_descriptions', 'role_profiles',
    'sfia_skills', 'sfia_categories', 'sfia_versions',
    'capability_areas', 'role_families'
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  // Clear the fictional placeholder text on the fixed 1-7 level rows, keep the rows themselves.
  db.prepare(`UPDATE sfia_levels SET level_full_description = NULL, source_reference = NULL`).run();
}

function run() {
  const admin = db.prepare(`SELECT * FROM users WHERE email = ?`).get(process.env.ADMIN_EMAIL?.trim().toLowerCase());
  if (!admin) throw new Error('Admin user not found - run the original seed script first to create the super admin account.');

  wipeContentTables();

  const version = db.prepare(`
    INSERT INTO sfia_versions (version_name, description, effective_from, status) VALUES (?, ?, date('now'), 'active')
  `).run('SFIA 9', 'Real SFIA 9 skill codes imported from EngineeringCareerPathsV3.xlsx. Skill names left as the code itself - no official SFIA names or descriptions have been added, since none were available in the source data. Replace with real content once available under the organisation\'s SFIA licence.');
  const versionId = version.lastInsertRowid;

  const tracks = [...new Set(ROLES.map(r => r.track))];
  const familyIdByTrack = {};
  for (const t of tracks) {
    const result = db.prepare(`INSERT INTO role_families (name) VALUES (?)`).run(t);
    familyIdByTrack[t] = result.lastInsertRowid;
  }

  const skillCodes = [...new Set(ROLES.flatMap(r => parseSkills(r.skillsRaw).map(s => s.code)))].sort();
  const skillIdByCode = {};
  for (const code of skillCodes) {
    const result = db.prepare(`
      INSERT INTO sfia_skills (sfia_version_id, skill_code, skill_name, short_description) VALUES (?, ?, ?, ?)
    `).run(versionId, code, code, 'Imported from EngineeringCareerPathsV3.xlsx - name/description not yet populated, admin to confirm against the licensed SFIA 9 catalogue.');
    skillIdByCode[code] = result.lastInsertRowid;
  }

  const levelIdByNumber = {};
  for (const row of db.prepare(`SELECT id, level_number FROM sfia_levels`).all()) {
    levelIdByNumber[row.level_number] = row.id;
  }

  const roleIdByTitle = {};
  for (const r of ROLES) {
    const summary = `${r.scope} Time horizon: ${r.timeHorizon}.`;
    const typicalOutputs = `Technical focus: ${r.techFocus}\n\nSkills & capability development: ${r.skillsDev}`;
    const dayInTheLife = `Leadership style: ${r.leadership}\n\nPeople & talent: ${r.people}\n\nExternal / ecosystem: ${r.external}`;
    const successIndicators = `Workforce impact: ${r.workforce}\n\nInclusion contribution: ${r.dei}`;
    const roleType = r.track === 'Management' ? 'Management' : 'Individual Contributor';

    const result = db.prepare(`
      INSERT INTO role_profiles (
        role_family_id, title, summary, responsibilities, seniority_level, role_type,
        status, owner_user_id, published_at, published_by,
        typical_outputs, day_in_the_life, success_indicators, role_at_a_glance, display_tags
      ) VALUES (?, ?, ?, ?, ?, ?, 'published', ?, datetime('now'), ?, ?, ?, ?, ?, ?)
    `).run(
      familyIdByTrack[r.track], r.title, summary, r.impact, deriveSeniority(r.title), roleType,
      admin.id, admin.id,
      typicalOutputs, dayInTheLife, successIndicators,
      JSON.stringify({ focusArea: r.track, totalPoints: r.totalPoints }),
      JSON.stringify([r.track])
    );
    roleIdByTitle[r.title] = result.lastInsertRowid;

    const skills = parseSkills(r.skillsRaw);
    skills.forEach((s, i) => {
      db.prepare(`
        INSERT INTO role_profile_skills (role_profile_id, sfia_skill_id, required_sfia_level_id, importance, display_order)
        VALUES (?, ?, ?, 'core', ?)
      `).run(result.lastInsertRowid, skillIdByCode[s.code], levelIdByNumber[s.level], i);
    });
  }

  // Career pathways: one per track, stages ordered by Time Horizon rank, progression connections
  // between consecutive stages only (no invented cross-track moves).
  for (const track of tracks) {
    const trackRoles = ROLES.filter(r => r.track === track)
      .slice()
      .sort((a, b) => TIME_HORIZON_RANK[a.timeHorizon] - TIME_HORIZON_RANK[b.timeHorizon]);

    const pathwayType = track === 'Management' ? 'Management' : (track === 'Technical' ? 'Specialist' : 'IC');
    const pathwayResult = db.prepare(`
      INSERT INTO career_pathways (pathway_name, pathway_description, role_family_id, pathway_type, status, owner_user_id, published_at, published_by)
      VALUES (?, ?, ?, ?, 'published', ?, datetime('now'), ?)
    `).run(`${track} Career Pathway`, `Progression ladder for the ${track} track, imported from EngineeringCareerPathsV3.xlsx.`,
      familyIdByTrack[track], pathwayType, admin.id, admin.id);
    const pathwayId = pathwayResult.lastInsertRowid;

    trackRoles.forEach((r, i) => {
      db.prepare(`
        INSERT INTO career_pathway_roles (career_pathway_id, role_profile_id, pathway_stage, is_starting_role, is_end_role)
        VALUES (?, ?, ?, ?, ?)
      `).run(pathwayId, roleIdByTitle[r.title], i + 1, i === 0 ? 1 : 0, i === trackRoles.length - 1 ? 1 : 0);
    });

    for (let i = 0; i < trackRoles.length - 1; i++) {
      db.prepare(`
        INSERT INTO career_pathway_connections (career_pathway_id, from_role_profile_id, to_role_profile_id, connection_type, connection_description)
        VALUES (?, ?, ?, 'progression', ?)
      `).run(pathwayId, roleIdByTitle[trackRoles[i].title], roleIdByTitle[trackRoles[i + 1].title],
        `Typical next step from ${trackRoles[i].title} to ${trackRoles[i + 1].title}.`);
    }
  }

  console.log('Import complete.');
  console.log(`Role families: ${tracks.length}`);
  console.log(`SFIA skills: ${skillCodes.length} (codes only, names not populated - see sfia_skills.short_description)`);
  console.log(`Role profiles: ${ROLES.length}`);
  console.log(`Career pathways: ${tracks.length}`);
  console.log('Learning resources were not imported (none present in the source spreadsheet) - admin can add real ones via the admin UI.');
}

run();
