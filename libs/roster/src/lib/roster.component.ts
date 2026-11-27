import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'realworld-roster',
  templateUrl: './roster.component.html',
  styleUrls: [],
  providers: [],
  imports: [CommonModule, HttpClientModule],
  standalone: true,
})
export class RosterComponent implements OnInit {
  roster: Array<{
    username: string;
    profileImage: string;
    articleCount: number;
    totalFavorites: number;
    firstArticleDate: string;
  }> = [];
  loading = true;
  error: string | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.http.get<{ roster: any[] }>('/api/roster').subscribe({
      next: (data) => {
        this.roster = data.roster;
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Failed to load roster';
        this.loading = false;
      },
    });
  }
}
