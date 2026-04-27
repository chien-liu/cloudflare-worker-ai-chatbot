# Personal Website Tech Stack (This website / Chien's website)

This website is a personal profile site built with **Next.js** on **React** and hosted on **Cloudflare**.

## Frontend stack

- **React** for the UI layer
- **Next.js App Router** for routing, layout, and production builds
- **Material UI (MUI)** for the component library and styling
- **Emotion** for styling support with MUI

## JavaScript and TypeScript

This project uses **both JavaScript and TypeScript**.

- **JavaScript / JSX** is the main language for the website pages and reusable components
- **TypeScript** is used for selected framework and platform configuration files

In short, the website application is primarily written in **JavaScript**, with **TypeScript** used where stronger configuration typing is helpful.

## Hosting and platform

- The website is hosted on **Cloudflare**
- The domain DNS is also hosted on **Cloudflare**
- GitHub is integrated with the deployment workflow so updates can be published from the repository

## GitHub and Cloudflare integration

This project uses **GitHub** as the source repository and **Cloudflare** as the hosting platform.

- Code changes are managed in GitHub
- Cloudflare is used to publish the website
- This setup keeps deployment simple and centralized

## Traffic capacity

This setup is well suited for a personal website.

- Cloudflare is designed to serve traffic at the edge and handle normal website traffic reliably
- For a profile or portfolio website, this architecture is generally capable of handling typical day-to-day traffic as well as traffic spikes from sharing, recruiting, or social media
- Actual capacity depends on the Cloudflare plan, application behavior, and any interactive backend features connected to the site

In practical terms, the setup is appropriate for a public personal website with room for normal growth.
