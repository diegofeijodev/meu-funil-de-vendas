import { ogImage, parsePinterestLink, parseRss, pinImageFromOembed } from '../pinterest';
import { RSS } from './fixtures';



describe('links do Pinterest', () => {
  it('Pin (qualquer subdomínio) vira o endereço canônico; pin.it fica para seguir o redirecionamento', () => {
    expect(parsePinterestLink('https://br.pinterest.com/pin/424605071146230977/')).toEqual({ kind: 'pin', pinId: '424605071146230977', url: 'https://www.pinterest.com/pin/424605071146230977/' });
    expect(parsePinterestLink('pinterest.com/pin/123?x=1')).toEqual({ kind: 'pin', pinId: '123', url: 'https://www.pinterest.com/pin/123/' });
    expect(parsePinterestLink('https://pin.it/2abcD')).toEqual({ kind: 'shortlink', url: 'https://pin.it/2abcD' });
  });

  it('pasta e perfil viram o RSS público; outro site ou página interna = null', () => {
    expect(parsePinterestLink('https://br.pinterest.com/foodnetwork/5-star-recipes/')).toEqual({
      kind: 'board', url: 'https://www.pinterest.com/foodnetwork/5-star-recipes/', rssUrl: 'https://www.pinterest.com/foodnetwork/5-star-recipes.rss',
    });
    expect(parsePinterestLink('https://www.pinterest.com/freelaapp')).toEqual({
      kind: 'profile', url: 'https://www.pinterest.com/freelaapp/', rssUrl: 'https://www.pinterest.com/freelaapp/feed.rss',
    });
    expect(parsePinterestLink('https://www.pinterest.com/search/pins/?q=bar')).toBeNull();
    expect(parsePinterestLink('https://www.pinterest.com/ideas/')).toBeNull();
    expect(parsePinterestLink('https://evil.com/pin/123/')).toBeNull();
    expect(parsePinterestLink('https://pinterest.com.evil.com/pin/123/')).toBeNull();
    expect(parsePinterestLink('não é link')).toBeNull();
  });
});

describe('RSS, oEmbed e og:image', () => {
  it('lê os itens com imagem (em 736x) e o id do Pin; item sem imagem fica de fora', () => {
    expect(parseRss(RSS)).toEqual([
      { pinId: 'e1_AfqPShxtN_7i28uqhW', link: 'https://www.pinterest.com/pin/e1_AfqPShxtN_7i28uqhW/', imageUrl: 'https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', title: 'Slow Cooker White Chicken Chili' },
      { pinId: '424605071146230977', link: 'https://www.pinterest.com/pin/424605071146230977/', imageUrl: 'https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', title: '' },
    ]);
    expect(parseRss('<html>não é rss</html>')).toEqual([]);
  });

  it('imagem do Pin pelo oEmbed (só i.pinimg.com) ou pelo og:image da página', () => {
    expect(pinImageFromOembed({ thumbnail_url: 'https://i.pinimg.com/236x/aa/bb/x.jpg' })).toBe('https://i.pinimg.com/736x/aa/bb/x.jpg');
    expect(pinImageFromOembed({ thumbnail_url: 'https://evil.com/x.jpg' })).toBeNull();
    expect(ogImage('<meta property="og:image" content="https://i.pinimg.com/originals/aa/x.jpg"/>')).toBe('https://i.pinimg.com/736x/aa/x.jpg');
    expect(ogImage('<html></html>')).toBeNull();
  });
});
