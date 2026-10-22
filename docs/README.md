# Nuroo Platform Documentation

This directory is the canonical technical and operational documentation for the web platform and
its backend API.

| Document                                          | Audience                    | Purpose                                                           |
| ------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| [Architecture](ARCHITECTURE.md)                   | Engineers                   | System boundaries, domain map, authorization model, ownership     |
| [Testing](TESTING.md)                             | Engineers, reviewers        | Test layers, commands, CI gates, and coverage policy              |
| [Billing Operations](BILLING_RUNBOOK.md)          | Engineers, on-call          | Stripe setup, billing modes, incident triage, migrations          |
| [Legal Review Required](LEGAL_REVIEW_REQUIRED.md) | Legal, product, engineering | Outstanding gaps between the product and legal documents          |
| [Project README](../README.md)                    | Engineers                   | Local setup, project structure, deployment                        |
| [Backend README](../backend/README.md)            | Backend engineers           | Backend setup, commands, directory structure, change requirements |

## Maintenance Rule

Documentation changes ship with the code that changes the documented behavior. Review these files
when changing domains, routes, API contracts, authentication or authorization, billing, or release
automation.

Legal documents require approval from qualified counsel before publication. Engineering keeps
service and data-flow facts accurate but does not replace legal review.
