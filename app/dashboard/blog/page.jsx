import ListArticles from '@/ui/pages/blog/ListArticles';
import axios from 'axios';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

async function getPosts() {
  let articles = [];

  try {
    const response = await axios.get(
      'https://benew-admin-next15.vercel.app/api/dashboard/blog',
      {
        // Désactiver le cache axios aussi
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
          // Ajouter des headers spécifiques pour les articles
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
        // Ajouter un timestamp pour éviter le cache navigateur
        params: {
          _t: Date.now(),
          // Optionnel: ajouter un paramètre pour forcer le refresh
          refresh: 'true',
        },
        // Configuration timeout pour éviter les blocages
        timeout: 10000, // 10 secondes
      },
    );

    console.log('response articles', response);

    // Vérifier que la réponse contient bien les articles
    if (response.data && response.data.articles) {
      articles = response.data.articles;
    } else if (response.data && Array.isArray(response.data)) {
      // Au cas où l'API retournerait directement un tableau
      articles = response.data;
    } else {
      console.warn(
        'Format de réponse inattendu pour les articles:',
        response.data,
      );
      articles = [];
    }

    console.log(
      `✅ Articles récupérés avec succès: ${articles.length} articles`,
    );
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des articles:', error);

    // Log plus détaillé selon le type d'erreur
    if (error.response) {
      // Erreur de réponse du serveur
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    } else if (error.request) {
      // Erreur de requête (pas de réponse)
      console.error('Pas de réponse reçue:', error.request);
    } else {
      // Erreur de configuration
      console.error('Erreur de configuration:', error.message);
    }

    // Retourner un tableau vide en cas d'erreur plutôt que de laisser undefined
    articles = [];
  }

  return articles;
}

const BlogPage = async () => {
  const articles = await getPosts();

  return <ListArticles data={articles} />;
};

export default BlogPage;
