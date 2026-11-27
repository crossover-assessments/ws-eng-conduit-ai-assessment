import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { User } from '../user/user.entity';
import { Article } from '../article/article.entity';

@Injectable()
export class RosterService {
  constructor(private readonly em: EntityManager) {}

  async getRoster() {
    // Fetch all users with their articles
    const users = await this.em.find(User, {}, { populate: ['articles'] });

    // For each user, compute stats
    const roster = users.map((user) => {
      const articles = user.articles.getItems();
      const articleCount = articles.length;
      const totalFavorites = articles.reduce((sum, a) => sum + (a.favoritesCount || 0), 0);
      const firstArticleDate =
        articles.length > 0
          ? articles
              .map((a) => a.createdAt)
              .reduce((min, d) => (d < min ? d : min), articles[0].createdAt)
              .toISOString()
          : '';

      return {
        username: user.username,
        profileImage: user.image,
        articleCount,
        totalFavorites,
        firstArticleDate,
      };
    });

    return { roster };
  }
}
