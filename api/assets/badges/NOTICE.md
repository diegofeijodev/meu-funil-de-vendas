# Selos oficiais das lojas

Arquivos oficiais, apenas recortados/rasterizados. **Não redesenhar, não recolorir, não substituir por imitação.**

| Arquivo | Origem | Tratamento |
|---|---|---|
| `google-play-pt-br.png` | https://play.google.com/intl/pt-BR/badges/static/images/badges/pt-br_badge_web_generic.png ("DISPONÍVEL NO Google Play") | só a margem transparente foi recortada (`convert -trim +repage`) e salvo em 8 bits RGBA |
| `app-store-pt-br.png` | https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/pt-br (SVG oficial "Baixar na App Store", versão preta) | SVG rasterizado com `convert -background none -density 600 in.svg -resize x240` e salvo em 8 bits RGBA |

Baixados em 28/10/2026. O endereço `tools.applemarketingtools.com/api/badges/...` (o primeiro tentado) não resolve mais no DNS; o
`toolbox.marketingtools.apple.com` é o domínio atual da própria Apple para os mesmos selos (o SVG traz o título
`Download_on_the_App_Store_Badge_PTBR_RGB_blk`).

Regras de uso:
- Google Play: https://play.google.com/intl/pt-BR/badges/ (diretrizes dos selos do Google Play)
- Apple: https://developer.apple.com/app-store/marketing/guidelines/ (Apple Marketing Guidelines — selos da App Store)
